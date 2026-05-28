// charts — barrel re-export of all chart components.
// Consumers import from '@/components/charts/charts' and get every chart
// as a named export, unchanged from the pre-split API.
// Re-exports ReferenceLine from recharts for consumers that need trend lines.

export { LineChart, BarChart, AreaChart, FunnelChart, ScatterChart } from './CartesianCharts';
export { PieChart, DonutChart, RadarChart, GaugeChart } from './PolarCharts';
export { HeatmapChart, TableChart } from './DisplayCharts';
export { ReferenceLine } from 'recharts';
