// Signals' colours, for the Signals page's chart and reports' charts alike.

// The reference palette's categorical order, a step per theme, validated
// against the card colours (#fff and #272727). In light mode slots 3, 4 and
// 5 are under 3:1 against white, so every line is also named in the list
// under the chart.
export const palette = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
};

// A palette slot takes this theme's step; a colour the person chose is as is.
export function colorFor(color: number | string, dark: boolean): string {
  return typeof color === 'number' ? (dark ? palette.dark : palette.light)[color] ?? palette.light[0] : color;
}
