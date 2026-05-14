import echarts from './register';

const BILI_DARK = {
  color: ['#FB7299', '#00A1D6', '#FFB347', '#7B68EE', '#00D4AA', '#FF6B6B', '#4ECDC4', '#FFE66D', '#A888FF', '#FF8A5C'],
  backgroundColor: 'transparent',
  textStyle: { color: '#A0A0B0' },
  title: { textStyle: { color: '#FFFFFF' } },
  legend: { textStyle: { color: '#A0A0B0' } },
  tooltip: {
    backgroundColor: '#222244',
    borderColor: '#333355',
    textStyle: { color: '#FFFFFF' },
  },
  grid: { borderColor: '#333355' },
};

echarts.registerTheme('bili-dark', BILI_DARK);
