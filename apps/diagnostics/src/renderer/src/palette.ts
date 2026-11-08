// Signals' colours, for the Signals page's chart and reports' charts alike.

// The reference palette's categorical order, a step per theme, validated
// against the card colours (#fff and #272727). In light mode slots 3, 4 and
// 5 are under 3:1 against white, so every line is also named in the list
// under the chart.
//   Slots 8 to 15 (a chart holds up to 16 signals) are the first eight's
// hues again, darker in light mode and lighter in dark mode, each at least
// 4.5:1 against its card.
export const palette = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948',
    '#1d5aa3', '#a8461f', '#127a55', '#8a6500', '#b3507a', '#5f7d1f', '#3f2fa3', '#0b7f96'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767',
    '#80b4f2', '#f0915f', '#4fcf9f', '#e3b44a', '#ee8fb4', '#9cc957', '#b6aef2', '#4cc4d9']
};

// A palette slot takes this theme's step; a colour the person chose is as is.
export function colorFor(color: number | string, dark: boolean): string {
  return typeof color === 'number' ? (dark ? palette.dark : palette.light)[color] ?? palette.light[0] : color;
}
