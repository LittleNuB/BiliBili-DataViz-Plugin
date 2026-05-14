import type { TooltipOption, GridOption, LegendOption } from 'echarts/types/dist/shared';

export const defaultTooltip: TooltipOption = {
  trigger: 'item',
  backgroundColor: '#222244',
  borderColor: '#333355',
  textStyle: { color: '#FFFFFF', fontSize: 12 },
};

export const defaultGrid: GridOption = {
  top: 10,
  right: 10,
  bottom: 10,
  left: 10,
  containLabel: true,
};

export const defaultLegend: LegendOption = {
  textStyle: { color: '#A0A0B0', fontSize: 12 },
  bottom: 0,
};
