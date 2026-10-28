-- Restore the empty declaration table for a rollback to migration 0038.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM valuation_jobs WHERE snapshot_gap = 'financial_filing_evidence_missing') THEN
    RAISE EXCEPTION 'financial filing gap exists; preserve jobs before rolling back 0039';
  END IF;
END $$;
CREATE TABLE financial_declarations (
  declaration_id uuid PRIMARY KEY NOT NULL,
  legal_entity_id uuid NOT NULL,
  fiscal_year_end date NOT NULL,
  version varchar(64) NOT NULL,
  payout numeric NOT NULL,
  rationale text NOT NULL,
  source_document_id varchar(256) NOT NULL,
  regulatory_capital text NOT NULL,
  asset_quality text NOT NULL,
  clean_surplus text NOT NULL,
  common_book jsonb,
  available_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT financial_declarations_payout_check CHECK (payout >= 0 AND payout <= 1),
  CONSTRAINT financial_declarations_timeline_check CHECK (available_at <= recorded_at)
);
CREATE INDEX financial_declarations_subject_cutoff_idx ON financial_declarations (legal_entity_id, fiscal_year_end, available_at);
ALTER TABLE valuation_jobs DROP CONSTRAINT valuation_jobs_run_check;
ALTER TABLE valuation_jobs ADD CONSTRAINT valuation_jobs_run_check CHECK ((valuation_jobs.valuation_run_id is null) = (valuation_jobs.run_status is null)
        and (valuation_jobs.run_status is null or valuation_jobs.run_status in ('computed', 'requires_review', 'rejected'))
        and (valuation_jobs.valuation_run_id is not null) = (valuation_jobs.gap is not null and valuation_jobs.gap::text = 'run_recorded')
        and (valuation_jobs.valuation_run_id is null or (valuation_jobs.method_status = 'selected' and valuation_jobs.method in ('fcff_base', 'normalized_fcff', 'excess_return')))
        and (valuation_jobs.snapshot_gap is null or valuation_jobs.gap::text = 'snapshot_not_assembled')
        and (valuation_jobs.snapshot_gap is null or valuation_jobs.snapshot_gap in ('method_not_derived', 'security_missing', 'cost_of_capital_unavailable', 'normalization_unavailable', 'revenue_history_insufficient', 'revenue_history_non_positive', 'base_margin_unavailable', 'sales_to_capital_unavailable', 'tax_rate_unavailable', 'employee_equity_not_proposed', 'shares_outstanding_unavailable', 'market_unavailable', 'financial_base_unavailable', 'financial_base_stale', 'financial_declaration_missing'))
        and (valuation_jobs.rule_version = 'valuation-job-1.0.0' or valuation_jobs.gap is null or valuation_jobs.gap::text <> 'snapshot_not_assembled' or valuation_jobs.snapshot_gap is not null)
        and (valuation_jobs.rule_version <> 'valuation-job-1.0.0' or (valuation_jobs.snapshot_gap is null and valuation_jobs.valuation_run_id is null)));
COMMIT;
