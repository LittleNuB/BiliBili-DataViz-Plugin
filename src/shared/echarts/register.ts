import * as echarts from 'echarts/core';
import wordCloudCustomSeriesInstaller from '@echarts-x/custom-word-cloud';
import { BarChart, CustomChart, LineChart, PieChart, TreemapChart, HeatmapChart, GaugeChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent,
  DataZoomComponent,
  CalendarComponent,
  GraphicComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use(wordCloudCustomSeriesInstaller);
echarts.use([
  BarChart,
  CustomChart,
  LineChart,
  PieChart,
  TreemapChart,
  HeatmapChart,
  GaugeChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent,
  DataZoomComponent,
  CalendarComponent,
  GraphicComponent,
  CanvasRenderer,
]);

export default echarts;
