ALTER TABLE public.purchases DROP COLUMN total_amount;
ALTER TABLE public.purchases ADD COLUMN total_amount numeric GENERATED ALWAYS AS (weight_kg * GREATEST(rate_per_kg - faraq, 0)) STORED;