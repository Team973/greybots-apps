// TODO: fix types
// @ts-nocheck

import { useViewModeStore } from '../stores/view-mode-store';



// Common chart colors
export const dataPointColor = "#c78000";
export const dataPointColorTranslucent = "#c7800080";
export const dataPointAccentColor = "#009879";
export const dataPointAccentColorTranslucent = "#00987980";

const lightModeColors = {
    red: '#f25d3fff',
    orange: '#e0a43aff',
    yellow: '#faf757ff',
    green: '#74de62ff',
    blue: '#6281deff',
    purple: '#9364deff',
    pink: '#d058e0ff',
};
export const randomColorWheelLightMode = [
    lightModeColors['red'],
    lightModeColors['orange'],
    lightModeColors['yellow'],
    lightModeColors['green'],
    lightModeColors['blue'],
    lightModeColors['purple'],
    lightModeColors['pink']
]

const darkModeColors = {
    red: '#963724ff',
    orange: '#9c6403ff',
    yellow: '#9e9b0bff',
    green: '#2e6924ff',
    blue: '#213266ff',
    purple: '#472c73ff',
    pink: '#9d33abff',
};
export const randomColorWheelDarkMode = [
    darkModeColors['red'],
    darkModeColors['orange'],
    darkModeColors['yellow'],
    darkModeColors['green'],
    darkModeColors['blue'],
    darkModeColors['purple'],
    darkModeColors['pink']
]

export const reefscapeColorWheel = [
    '#ff55ecff', '#5dfc75ff', '#647afaff'
]


// radar color options
const radarRedStyle = {
    background: {
        color: 'rgba(255,99,132,0.2)'
    },
    border: {
        color: 'rgba(255,99,132,1)'
    },
    point: {
        background: {
            color: 'rgba(255,99,132,1)',
            hoverColor: "#FFF"
        },
        border: {
            color: "#FFF",
            hoverColor: 'rgba(255,99,132,1)'
        }
    }
}

const radarGreenStyle = {
    background: {
        color: 'rgba(99,255,132,0.2)'
    },
    border: {
        color: 'rgba(99,255,132,1)'
    },
    point: {
        background: {
            color: 'rgba(99,255,132,1)',
            hoverColor: "#FFF"
        },
        border: {
            color: "#FFF",
            hoverColor: 'rgba(99,255,132,1)'
        }
    }
}

const radarBlueStyle = {
    background: {
        color: 'rgba(99,132,255,0.2)'
    },
    border: {
        color: 'rgba(99,132,255,1)'
    },
    point: {
        background: {
            color: 'rgba(99,132,255,1)',
            hoverColor: "#FFF"
        },
        border: {
            color: "#FFF",
            hoverColor: 'rgba(99,132,255,1)'
        }
    }
}

export const radarChartColorWheel = [
    radarRedStyle,
    radarGreenStyle,
    radarBlueStyle
];


// Light mode chart colors
const chartTextColorLightMode =
{
    axesText: "#555",
    dataLabels: "#333",
    legend: "#555"
};

const chartGridColorLightMode = {
    axes: "rgba(0, 0, 0, 0.1)",
}

const colorWheelsLightMode = {
    radar: radarChartColorWheel,
    random: randomColorWheelLightMode
}

const lightThemeColors = {
    text: chartTextColorLightMode,
    grid: chartGridColorLightMode,
    background: 'rgba(255, 255, 255, 0)',
    wheels: colorWheelsLightMode,
    colors: lightModeColors
}

// Dark mode chart colors
const chartTextColorDarkMode = {
    axesText: "#AAA",
    dataLabels: "#DDD",
    legend: "#AAA"
};

const chartGridColorDarkMode = {
    lines: "rgba(255, 255, 255, 0.1)",
}

const colorWheelsDarkMode = {
    radar: radarChartColorWheel,
    random: randomColorWheelDarkMode
}

const darkThemeColors = {
    text: chartTextColorDarkMode,
    grid: chartGridColorDarkMode,
    background: "#27272700",
    wheels: colorWheelsDarkMode,
    colors: darkModeColors
}


export function getThemeColors() {
    const viewMode = useViewModeStore();

    if (viewMode.isDarkMode) {
        return darkThemeColors;
    }
    return lightThemeColors;
}