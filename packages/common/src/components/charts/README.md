
## Chart Data Schemas

BarChart, LineChart:
DiscreteDataSeries
```
color = ""
data = [
    {
        name: "",
        labels: [l1, l2, ..., ln],
        y: [y1, y2, ..., yn]
    }
]

```

ScatterChart:
CartesianDataSeries
```
color = ""
data = [
    {
        name: "",
        labels: [l1, l2, ..., ln],
        x: [x1, x2, ..., xn],
        y: [y1, y2, ..., yn]
    }
]

```


BoxPlot:
SampledDataSeries
```
data = [
    {
        labels: [l1, l2, ..., ln],
        values: [y1, y2, ..., yn]
    }
]
```
Note: `data` is a single element array for BoxPlot to conform with other specifications of `data`


StackedBarChart:
```
data = [
    {
        name: "",
        labels: [l1, l2, ..., ln],
        y: [y1, y2, ..., yn]
    },
    ...
    {
        name: "",
        labels: [l1, l2, ..., ln],
        y: [y1, y2, ..., yn]
    }
]
```

PieChart, DoughnutChart:
```
labels = [x1, x2, ..., xn]
values = [y1, y2, ..., yn]
```

RadarChart:
```
style = [
    "border": {
        "color": "#COLOR"
    },
    "background": {
        "color": "#COLOR"
    },
    "point": {
        "border": {
            "color": "#COLOR",
            "hoverColor": "#COLOR"
        },
        "background": {
            "color": "#COLOR",
            "hoverColor": "#COLOR"
        }
    }
]

data = [
    {
        name: "",
        labels: [l1, l2, ..., ln],
        y: [y1, y2, ..., yn]
    },
    ...
    {
        name: "",
        labels: [l1, l2, ..., ln],
        y: [y1, y2, ..., yn]
    }
]
```



## Chart Style Schema

BarChart:


LineChart, ScatterChart:



BoxPlot:
```
style = {
    "border": {
        "width": 3,
        "color": "#COLOR"
    },
    "sample": {
        "shape": "circle",
        "size": 2,
        "color": "#COLOR"
    }
}
```


StackedBarChart:
```
colors = ["#COLOR", ...]
```