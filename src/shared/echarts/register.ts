import * as echarts from 'echarts/core';
import wordCloudCustomSeriesInstaller from '@echarts-x/custom-word-cloud';
import { BarChart, CustomChart, LineChart, PieChart, HeatmapChart, GaugeChart } from 'echarts/charts';
import {
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use(wordCloudCustomSeriesInstaller);
echarts.use([
  BarChart,
  CustomChart,
  LineChart,
  PieChart,
  HeatmapChart,
  GaugeChart,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export default echarts;
