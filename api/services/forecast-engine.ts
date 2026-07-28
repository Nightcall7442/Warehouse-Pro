/**
 * Forecast Engine — Simple demand forecasting algorithms.
 * Uses pure TypeScript math (no external ML dependencies).
 */

/** Daily demand data point */
export interface DemandPoint {
  date: string; // YYYY-MM-DD
  quantity: number;
}

/** Forecast result with confidence interval */
export interface ForecastResult {
  date: string;
  predicted: number;
  lower: number; // 95% CI lower bound
  upper: number; // 95% CI upper bound
}

/**
 * Simple Moving Average (SMA)
 * @param data - historical demand points (sorted by date ascending)
 * @param window - rolling window size in days (default: 7)
 * @param horizon - number of days to forecast (default: 14)
 */
export function simpleMovingAverage(
  data: DemandPoint[],
  window = 7,
  horizon = 14
): ForecastResult[] {
  if (data.length < window) return [];

  const quantities = data.map(d => d.quantity);
  const lastDate = new Date(data[data.length - 1].date);

  // Calculate moving average for historical data to estimate variance
  const residuals: number[] = [];
  for (let i = window; i < quantities.length; i++) {
    const avg = quantities.slice(i - window, i).reduce((a, b) => a + b, 0) / window;
    residuals.push(quantities[i] - avg);
  }

  const stdDev = residuals.length > 1
    ? Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (residuals.length - 1))
    : 0;

  // Last window average as forecast
  const lastWindow = quantities.slice(-window);
  const forecastValue = lastWindow.reduce((a, b) => a + b, 0) / window;

  const results: ForecastResult[] = [];
  for (let i = 1; i <= horizon; i++) {
    const date = new Date(lastDate);
    date.setDate(date.getDate() + i);
    results.push({
      date: date.toISOString().split("T")[0],
      predicted: Math.max(0, Math.round(forecastValue * 100) / 100),
      lower: Math.max(0, Math.round((forecastValue - 1.96 * stdDev) * 100) / 100),
      upper: Math.round((forecastValue + 1.96 * stdDev) * 100) / 100,
    });
  }

  return results;
}

/**
 * Exponential Smoothing (Single / SES)
 * @param data - historical demand points
 * @param alpha - smoothing factor (0-1, default 0.3)
 * @param horizon - days to forecast
 */
export function exponentialSmoothing(
  data: DemandPoint[],
  alpha = 0.3,
  horizon = 14
): ForecastResult[] {
  if (data.length < 3) return [];

  const quantities = data.map(d => d.quantity);
  const lastDate = new Date(data[data.length - 1].date);

  // Compute smoothed values and residuals
  let smoothed = quantities[0];
  const residuals: number[] = [];
  for (let i = 1; i < quantities.length; i++) {
    smoothed = alpha * quantities[i] + (1 - alpha) * smoothed;
    residuals.push(quantities[i] - smoothed);
  }

  const stdDev = residuals.length > 1
    ? Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (residuals.length - 1))
    : 0;

  // Forecast is the last smoothed value
  const forecastValue = smoothed;

  const results: ForecastResult[] = [];
  for (let i = 1; i <= horizon; i++) {
    const date = new Date(lastDate);
    date.setDate(date.getDate() + i);
    results.push({
      date: date.toISOString().split("T")[0],
      predicted: Math.max(0, Math.round(forecastValue * 100) / 100),
      lower: Math.max(0, Math.round((forecastValue - 1.96 * stdDev) * 100) / 100),
      upper: Math.round((forecastValue + 1.96 * stdDev) * 100) / 100,
    });
  }

  return results;
}

/**
 * Linear Regression for trend detection
 * @returns { slope, intercept, r2 } — y = slope * x + intercept
 */
export function linearRegression(data: DemandPoint[]): {
  slope: number;
  intercept: number;
  r2: number;
} {
  const n = data.length;
  if (n < 3) return { slope: 0, intercept: 0, r2: 0 };

  const quantities = data.map(d => d.quantity);
  const x = quantities.map((_, i) => i); // 0, 1, 2, ...

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = quantities.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * quantities[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const meanY = sumY / n;
  const ssTot = quantities.reduce((acc, yi) => acc + (yi - meanY) ** 2, 0);
  const ssRes = quantities.reduce((acc, yi, i) => acc + (yi - (slope * x[i] + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

/**
 * Linear trend forecast
 * @param data - historical demand points
 * @param horizon - days to forecast
 */
export function linearTrendForecast(
  data: DemandPoint[],
  horizon = 14
): ForecastResult[] {
  if (data.length < 7) return [];

  const { slope, intercept } = linearRegression(data);
  const lastDate = new Date(data[data.length - 1].date);
  const n = data.length;

  // Estimate residuals for confidence interval
  const quantities = data.map(d => d.quantity);
  const residuals = quantities.map((y, i) => y - (slope * i + intercept));
  const stdDev = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (residuals.length - 1));

  const results: ForecastResult[] = [];
  for (let i = 1; i <= horizon; i++) {
    const date = new Date(lastDate);
    date.setDate(date.getDate() + i);
    const predicted = slope * (n + i - 1) + intercept;
    results.push({
      date: date.toISOString().split("T")[0],
      predicted: Math.max(0, Math.round(predicted * 100) / 100),
      lower: Math.max(0, Math.round((predicted - 1.96 * stdDev) * 100) / 100),
      upper: Math.round((predicted + 1.96 * stdDev) * 100) / 100,
    });
  }

  return results;
}

/**
 * Detect weekly seasonality (7-day pattern)
 * Returns average quantity per day of week (0=Sun, 6=Sat)
 */
export function weeklySeasonality(data: DemandPoint[]): number[] {
  const dayTotals = new Array(7).fill(0);
  const dayCounts = new Array(7).fill(0);

  for (const point of data) {
    const dayOfWeek = new Date(point.date).getDay();
    dayTotals[dayOfWeek] += point.quantity;
    dayCounts[dayOfWeek]++;
  }

  return dayTotals.map((total, i) =>
    dayCounts[i] > 0 ? Math.round((total / dayCounts[i]) * 100) / 100 : 0
  );
}

/**
 * Best method selector — picks the algorithm with lowest RMSE on historical data
 */
export function bestForecastMethod(
  data: DemandPoint[],
  horizon = 14
): { method: string; forecast: ForecastResult[] } {
  const methods = [
    { name: "SMA-7", fn: () => simpleMovingAverage(data, 7, horizon) },
    { name: "SMA-14", fn: () => simpleMovingAverage(data, 14, horizon) },
    { name: "ES-0.3", fn: () => exponentialSmoothing(data, 0.3, horizon) },
    { name: "Linear", fn: () => linearTrendForecast(data, horizon) },
  ];

  let bestMethod = methods[0];
  let bestRMSE = Infinity;

  for (const method of methods) {
    const forecast = method.fn();
    if (forecast.length === 0) continue;

    // Calculate RMSE on last 14 days of historical data
    const testSize = Math.min(14, data.length - 7);
    if (testSize <= 0) continue;

    const trainData = data.slice(0, -testSize);
    const testData = data.slice(-testSize);
    const trainForecast = method.name.includes("SMA-7")
      ? simpleMovingAverage(trainData, 7, testSize)
      : method.name.includes("SMA-14")
        ? simpleMovingAverage(trainData, 14, testSize)
        : method.name.includes("ES")
          ? exponentialSmoothing(trainData, 0.3, testSize)
          : linearTrendForecast(trainData, testSize);

    if (trainForecast.length === 0) continue;

    const rmse = Math.sqrt(
      testData.reduce((sum, point, i) => {
        const predicted = trainForecast[i]?.predicted ?? 0;
        return sum + (point.quantity - predicted) ** 2;
      }, 0) / testSize
    );

    if (rmse < bestRMSE) {
      bestRMSE = rmse;
      bestMethod = method;
    }
  }

  return { method: bestMethod.name, forecast: bestMethod.fn() };
}
