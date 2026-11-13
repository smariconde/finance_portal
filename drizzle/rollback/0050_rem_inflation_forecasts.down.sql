-- Manual rollback for 0050_rem_inflation_forecasts.sql.
-- Run only after deliberately deciding to remove all REM forecast vintages.
DROP TABLE "rem_inflation_forecasts";
