/**
 * Number of property-test runs. Defaults to the value a test asks for; the
 * heavy verification script raises it for every property with FERRY_FC_RUNS.
 */
export function runs(defaultRuns: number): number {
  const override = Number(process.env['FERRY_FC_RUNS']);
  return Number.isInteger(override) && override > 0 ? override : defaultRuns;
}
