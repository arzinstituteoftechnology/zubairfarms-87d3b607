
-- Shop ledger enum extensions
ALTER TYPE public.shop_ledger_type ADD VALUE IF NOT EXISTS 'reversed_supply';
ALTER TYPE public.shop_ledger_type ADD VALUE IF NOT EXISTS 'reversed_manual_supply';
ALTER TYPE public.shop_ledger_type ADD VALUE IF NOT EXISTS 'reversed_manual_payment';
ALTER TYPE public.shop_ledger_type ADD VALUE IF NOT EXISTS 'reversed_adjustment_increase';
ALTER TYPE public.shop_ledger_type ADD VALUE IF NOT EXISTS 'reversed_adjustment_decrease';
ALTER TYPE public.shop_ledger_type ADD VALUE IF NOT EXISTS 'reversed_opening_balance';

-- Supplier ledger enum extensions
ALTER TYPE public.supplier_ledger_type ADD VALUE IF NOT EXISTS 'reversed_purchase';
ALTER TYPE public.supplier_ledger_type ADD VALUE IF NOT EXISTS 'reversed_payment';
ALTER TYPE public.supplier_ledger_type ADD VALUE IF NOT EXISTS 'reversed_manual_purchase';
ALTER TYPE public.supplier_ledger_type ADD VALUE IF NOT EXISTS 'reversed_manual_payment';
ALTER TYPE public.supplier_ledger_type ADD VALUE IF NOT EXISTS 'reversed_adjustment_increase';
ALTER TYPE public.supplier_ledger_type ADD VALUE IF NOT EXISTS 'reversed_adjustment_decrease';
ALTER TYPE public.supplier_ledger_type ADD VALUE IF NOT EXISTS 'reversed_opening_balance';

-- Audit columns on ledger tables
ALTER TABLE public.shop_ledger_entries
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_notes text,
  ADD COLUMN IF NOT EXISTS original_entry_id uuid,
  ADD COLUMN IF NOT EXISTS reversal_entry_id uuid;

ALTER TABLE public.supplier_ledger_entries
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_notes text,
  ADD COLUMN IF NOT EXISTS original_entry_id uuid,
  ADD COLUMN IF NOT EXISTS reversal_entry_id uuid;

-- Audit columns on source transaction tables
ALTER TABLE public.supplies
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_notes text,
  ADD COLUMN IF NOT EXISTS reversal_ledger_entry_id uuid;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_notes text,
  ADD COLUMN IF NOT EXISTS reversal_ledger_entry_id uuid;

ALTER TABLE public.farm_payments
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_notes text,
  ADD COLUMN IF NOT EXISTS reversal_ledger_entry_id uuid;

ALTER TABLE public.shop_recoveries
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_notes text,
  ADD COLUMN IF NOT EXISTS reversal_ledger_entry_id uuid;
