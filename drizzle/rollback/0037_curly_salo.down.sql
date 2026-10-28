-- Roll back F6-20 only after preserving private declarations and financial runs.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM financial_declarations) THEN
    RAISE EXCEPTION 'financial declarations exist; preserve them before rolling back 0037';
  END IF;
  IF EXISTS (SELECT 1 FROM valuation_jobs WHERE valuation_run_id IS NOT NULL AND method = 'excess_return') THEN
    RAISE EXCEPTION 'a ticker job records an excess_return run; preserve it before rolling back 0037';
  END IF;
END $$;
ALTER TABLE valuation_jobs DROP CONSTRAINT valuation_jobs_run_check;
ALTER TABLE valuation_jobs ADD CONSTRAINT valuation_jobs_run_check CHECK ((valuation_jobs.valuation_run_id is null) = (valuation_jobs.run_status is null)
        and (valuation_jobs.run_status is null or valuation_jobs.run_status in ('computed', 'requires_review', 'rejected'))
        and (valuation_jobs.valuation_run_id is not null) = (valuation_jobs.gap is not null and valuation_jobs.gap::text = 'run_recorded')
        and (valuation_jobs.valuation_run_id is null or (valuation_jobs.method_status = 'selected' and valuation_jobs.method in ('fcff_base', 'normalized_fcff')))
        and (valuation_jobs.snapshot_gap is null or valuation_jobs.gap::text = 'snapshot_not_assembled')
        and (valuation_jobs.snapshot_gap is null or valuation_jobs.snapshot_gap in ('method_not_derived', 'security_missing', 'cost_of_capital_unavailable', 'normalization_unavailable', 'revenue_history_insufficient', 'revenue_history_non_positive', 'base_margin_unavailable', 'sales_to_capital_unavailable', 'tax_rate_unavailable', 'employee_equity_not_proposed', 'shares_outstanding_unavailable', 'market_unavailable'))
        and (valuation_jobs.rule_version = 'valuation-job-1.0.0' or valuation_jobs.gap is null or valuation_jobs.gap::text <> 'snapshot_not_assembled' or valuation_jobs.snapshot_gap is not null)
        and (valuation_jobs.rule_version <> 'valuation-job-1.0.0' or (valuation_jobs.snapshot_gap is null and valuation_jobs.valuation_run_id is null)));
DROP TABLE financial_declarations;
COMMIT;
