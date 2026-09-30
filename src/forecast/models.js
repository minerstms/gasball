import { FEATURE_NAMES } from "./features.js";

function columnsNamed(names) {
  return names.map((name) => {
    const index = FEATURE_NAMES.indexOf(name);
    if (index < 0) throw new Error(`unknown feature ${name}`);
    return index;
  });
}

export const COMPARE_MODELS = [
  { id: "distributedLag", columns: null },
  {
    id: "spotOnly",
    columns: columnsNamed(["d_spot_0", "d_spot_1", "d_spot_2"])
  },
  {
    id: "retailWholesale",
    columns: columnsNamed([
      "d_retail_0",
      "d_retail_1",
      "d_retail_2",
      "d_retail_3",
      "d_spot_0",
      "d_spot_1",
      "d_spot_2"
    ])
  }
];

export function projectFeatures(values, columns) {
  if (!columns) return values;
  return columns.map((index) => values[index]);
}
