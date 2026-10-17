-- FORME checkout: atomic order creation, item snapshots, and stock deduction.
-- Run in the Supabase SQL Editor after reviewing the existing orders policies.
-- This updates the existing orders table with payment references and replaces
-- the checkout RPC signature; it does not change product or variant schemas.
-- Authenticated checkout calls create_checkout_order directly. The optional
-- guest-order claim migration preserves the legacy guest-order claim flow.

-- Razorpay needs a server-side link to the gateway order and, for guest
-- checkout, a per-order capability hash. The raw guest token never reaches SQL.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS razorpay_order_id text,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id text,
  ADD COLUMN IF NOT EXISTS guest_payment_token_hash text;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forme_customer_read_own_orders ON public.orders;
CREATE POLICY forme_customer_read_own_orders
  ON public.orders FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS forme_customer_read_own_order_items ON public.order_items;
CREATE POLICY forme_customer_read_own_order_items
  ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.orders AS customer_order
    WHERE customer_order.id = order_items.order_id
      AND customer_order.user_id = (SELECT auth.uid())
  ));

GRANT SELECT ON public.orders, public.order_items TO authenticated;

-- Replace the old 8-argument signature so every new guest checkout binds its
-- private payment capability atomically to the order it creates.
DROP FUNCTION IF EXISTS public.create_checkout_order(text, text, text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.create_checkout_order(text, text, text, text, text, text, text, jsonb, text);

CREATE FUNCTION public.create_checkout_order(
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping_address text,
  p_shipping_city text,
  p_shipping_state text,
  p_shipping_pincode text,
  p_items jsonb,
  p_guest_payment_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item jsonb;
  v_variant public.product_variants%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_quantity integer;
  v_expected_price bigint;
  v_expected_stock integer;
  v_unit_price bigint;
  v_subtotal bigint := 0;
  v_shipping bigint := 0;
  v_discount bigint := 0;
  v_total bigint := 0;
  v_order_id public.orders.id%TYPE;
  v_new_stock integer;
BEGIN
  IF p_customer_name IS NULL OR length(btrim(p_customer_name)) = 0
     OR p_customer_email IS NULL OR position('@' IN btrim(p_customer_email)) < 2
     OR p_customer_phone IS NULL OR length(btrim(p_customer_phone)) < 7
     OR p_shipping_address IS NULL OR length(btrim(p_shipping_address)) = 0
     OR p_shipping_city IS NULL OR length(btrim(p_shipping_city)) = 0
     OR p_shipping_state IS NULL OR length(btrim(p_shipping_state)) = 0
     OR p_shipping_pincode IS NULL OR p_shipping_pincode !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'customer_details_invalid';
  END IF;

  IF auth.uid() IS NULL AND (p_guest_payment_token_hash IS NULL OR p_guest_payment_token_hash !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_payment_token_invalid';
  END IF;
  IF auth.uid() IS NOT NULL AND p_guest_payment_token_hash IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unexpected_guest_payment_token';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cart_invalid';
  END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cart_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(value)
    GROUP BY entry.value ->> 'variant_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cart_invalid';
  END IF;

  -- Lock variants in a stable order. Product rows are then locked in the same
  -- variant order, so concurrent checkouts serialize without overselling.
  FOR v_item IN
    SELECT entry.value
    FROM jsonb_array_elements(p_items) AS entry(value)
    ORDER BY entry.value ->> 'variant_id'
  LOOP
    BEGIN
      v_quantity := (v_item ->> 'quantity')::integer;
      v_expected_price := (v_item ->> 'expected_unit_price_paise')::bigint;
      v_expected_stock := (v_item ->> 'expected_stock')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cart_invalid';
    END;

    IF v_quantity < 1 OR v_expected_price < 0 OR v_expected_stock < 0
       OR coalesce(v_item ->> 'variant_id', '') = ''
       OR coalesce(v_item ->> 'product_id', '') = '' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cart_invalid';
    END IF;

    SELECT * INTO v_variant
    FROM public.product_variants AS variant
    WHERE variant.id::text = v_item ->> 'variant_id'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'variant_unavailable';
    END IF;

    IF v_variant.product_id::text <> v_item ->> 'product_id' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cart_invalid';
    END IF;

    SELECT * INTO v_product
    FROM public.products AS product
    WHERE product.id = v_variant.product_id
    FOR UPDATE;
    IF NOT FOUND OR NOT coalesce(v_product.is_active, true) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'product_unavailable';
    END IF;

    v_unit_price := coalesce(v_product.price_paise, 0);
    IF v_unit_price <> v_expected_price THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'price_changed';
    END IF;
    IF v_variant.stock IS DISTINCT FROM v_expected_stock THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stock_changed';
    END IF;
    IF v_variant.stock IS NULL OR v_variant.stock < v_quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'insufficient_stock';
    END IF;

    v_subtotal := v_subtotal + (v_unit_price * v_quantity);
  END LOOP;

  v_shipping := CASE WHEN v_subtotal >= 99900 THEN 0 WHEN v_subtotal > 0 THEN 9900 ELSE 0 END;
  v_total := v_subtotal + v_shipping - v_discount;

  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_city, shipping_state, shipping_pincode,
    subtotal_paise, shipping_paise, discount_paise, total_paise,
    payment_status, order_status, guest_payment_token_hash
  ) VALUES (
    auth.uid(), btrim(p_customer_name), lower(btrim(p_customer_email)), btrim(p_customer_phone),
    btrim(p_shipping_address), btrim(p_shipping_city), btrim(p_shipping_state), btrim(p_shipping_pincode),
    v_subtotal, v_shipping, v_discount, v_total,
    'pending', 'pending', CASE WHEN auth.uid() IS NULL THEN p_guest_payment_token_hash ELSE NULL END
  ) RETURNING id INTO v_order_id;

  -- The function call is one PostgreSQL transaction. Any failure here rolls
  -- back the order, all items, and every stock change made in this loop.
  FOR v_item IN
    SELECT entry.value
    FROM jsonb_array_elements(p_items) AS entry(value)
    ORDER BY entry.value ->> 'variant_id'
  LOOP
    v_quantity := (v_item ->> 'quantity')::integer;
    v_expected_stock := (v_item ->> 'expected_stock')::integer;

    SELECT * INTO v_variant
    FROM public.product_variants AS variant
    WHERE variant.id::text = v_item ->> 'variant_id'
    FOR UPDATE;
    SELECT * INTO v_product
    FROM public.products AS product
    WHERE product.id = v_variant.product_id
    FOR UPDATE;

    UPDATE public.product_variants AS variant
    SET stock = variant.stock - v_quantity
    WHERE variant.id = v_variant.id
      AND variant.stock = v_expected_stock
      AND variant.stock >= v_quantity
    RETURNING variant.stock INTO v_new_stock;
    IF NOT FOUND OR v_new_stock < 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stock_changed';
    END IF;

    v_unit_price := coalesce(v_product.price_paise, 0);
    INSERT INTO public.order_items (
      order_id, product_id, product_name, product_image_path,
      variant_id, sku, size, color_name, quantity,
      unit_price_paise, total_price_paise
    ) VALUES (
      v_order_id, v_product.id, v_product.name, v_product.image_path,
      v_variant.id, v_variant.sku, v_variant.size, v_variant.color_name, v_quantity,
      v_unit_price, v_unit_price * v_quantity
    );
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'subtotal_paise', v_subtotal,
    'shipping_paise', v_shipping,
    'discount_paise', v_discount,
    'total_paise', v_total,
    'payment_status', 'pending',
    'order_status', 'pending'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_checkout_order(text, text, text, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(text, text, text, text, text, text, text, jsonb, text) TO authenticated;

-- Only trusted Edge Functions using the project service role may mark an order
-- paid. This prevents browser-side admin controls or direct client requests
-- from forging successful payment status.
CREATE OR REPLACE FUNCTION public.forme_guard_paid_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.payment_status = 'paid'
     AND OLD.payment_status IS DISTINCT FROM 'paid'
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'payment_status_paid_requires_verified_server';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.forme_guard_paid_order_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS forme_guard_paid_order_status ON public.orders;
CREATE TRIGGER forme_guard_paid_order_status
  BEFORE UPDATE OF payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.forme_guard_paid_order_status();
