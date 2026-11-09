import { createTheme, ThemeOptions } from '@mui/material';
import { DS_COLORS, DS_FONTS, DS_RADII, DS_SHADOWS } from './tokens';

interface CustomThemeVars {
  appPadding: {
    x: number;
    y: number;
  };
  toolMenu: {
    height: number;
  };
  customPalette: {
    [key in string]: string;
  };
}

declare module '@mui/material/styles' {
  interface Theme {
    customVars: CustomThemeVars;
  }

  interface ThemeOptions {
    customVars: CustomThemeVars;
  }
}

export const customVars: CustomThemeVars = {
  appPadding: {
    x: 40,
    y: 40
  },
  toolMenu: {
    height: 40
  },
  customPalette: {
    diagramBg: DS_COLORS.canvasSoft,
    // Neutral default for new connectors and rectangles: colour is for meaning.
    defaultColor: '#c7c7c7'
  }
};

/** MUI's 25 elevation levels mapped onto the design file's five stacked levels. */
const createShadows = () =>
  Array.from({ length: 25 }, (_, level) => {
    if (level === 0) return 'none';
    if (level <= 2) return DS_SHADOWS[2];
    if (level <= 4) return DS_SHADOWS[3];
    if (level <= 8) return DS_SHADOWS[4];
    return DS_SHADOWS[5];
  }) as Required<ThemeOptions>['shadows'];

const heading = { fontWeight: 600, letterSpacing: '-0.02em' };

export const themeConfig: ThemeOptions = {
  customVars,
  shadows: createShadows(),
  shape: {
    borderRadius: DS_RADII.sm
  },
  transitions: {
    duration: {
      shortest: 50,
      shorter: 100,
      short: 150,
      standard: 200,
      complex: 250,
      enteringScreen: 150,
      leavingScreen: 100
    }
  },
  typography: {
    fontFamily: DS_FONTS.sans,
    fontWeightBold: 600,
    h1: heading,
    h2: {
      ...heading,
      fontSize: '4em',
      lineHeight: 1.2
    },
    h3: heading,
    h4: heading,
    h5: {
      ...heading,
      fontSize: '1.3em',
      lineHeight: 1.2
    },
    h6: heading,
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 500 },
    body1: {
      fontSize: '0.85em',
      lineHeight: 1.2
    },
    body2: {
      fontSize: '0.75em',
      lineHeight: 1.2
    },
    button: {
      textTransform: 'none',
      fontWeight: 500,
      letterSpacing: 0
    }
  },
  palette: {
    primary: { main: DS_COLORS.ink, contrastText: DS_COLORS.onInk },
    secondary: { main: DS_COLORS.ink, contrastText: DS_COLORS.onInk },
    error: { main: DS_COLORS.error },
    warning: { main: DS_COLORS.warning },
    info: { main: DS_COLORS.link },
    success: { main: DS_COLORS.ok },
    text: {
      primary: DS_COLORS.ink,
      secondary: DS_COLORS.body,
      disabled: DS_COLORS.hairlineStrong
    },
    divider: DS_COLORS.hairline,
    background: {
      default: DS_COLORS.canvasSoft,
      paper: DS_COLORS.canvas
    },
    action: {
      hover: 'rgba(0,0,0,0.04)',
      selected: 'rgba(0,0,0,0.06)'
    }
  },
  components: {
    MuiCard: {
      defaultProps: {
        elevation: 0,
        variant: 'outlined'
      },
      styleOverrides: {
        root: {
          borderColor: DS_COLORS.hairline,
          borderRadius: DS_RADII.md
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        rounded: { borderRadius: DS_RADII.md }
      }
    },
    MuiToolbar: {
      styleOverrides: {
        root: {
          backgroundColor: DS_COLORS.canvas
        }
      }
    },
    MuiButtonBase: {
      defaultProps: {
        disableRipple: true,
        disableTouchRipple: true
      }
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
        variant: 'contained',
        disableRipple: true,
        disableTouchRipple: true
      },
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: DS_RADII.sm,
          fontWeight: 500,
          boxShadow: 'none'
        },
        containedPrimary: {
          '&:hover': { backgroundColor: '#383838', boxShadow: 'none' }
        },
        outlined: {
          color: DS_COLORS.ink,
          borderColor: DS_COLORS.hairline,
          backgroundColor: DS_COLORS.canvas,
          '&:hover': {
            borderColor: DS_COLORS.hairlineStrong,
            backgroundColor: DS_COLORS.canvasSoft2
          }
        },
        text: {
          color: DS_COLORS.ink,
          '&:hover': { backgroundColor: DS_COLORS.canvasSoft2 }
        }
      }
    },
    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: DS_RADII.sm }
      }
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderColor: DS_COLORS.hairline,
          color: DS_COLORS.body,
          '&.Mui-selected': {
            color: DS_COLORS.ink,
            backgroundColor: DS_COLORS.canvasSoft2
          }
        }
      }
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: DS_RADII.lg,
          boxShadow: DS_SHADOWS[5]
        }
      }
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontWeight: 600, letterSpacing: '-0.02em' }
      }
    },
    MuiBackdrop: {
      styleOverrides: {
        root: {
          '&:not(.MuiBackdrop-invisible)': {
            backgroundColor: 'rgba(0,0,0,0.32)'
          }
        }
      }
    },
    MuiPopover: {
      styleOverrides: {
        paper: { borderRadius: DS_RADII.md, boxShadow: DS_SHADOWS[5] }
      }
    },
    MuiMenu: {
      styleOverrides: {
        paper: { borderRadius: DS_RADII.md, boxShadow: DS_SHADOWS[5] }
      }
    },
    MuiMenuItem: {
      styleOverrides: {
        root: { fontSize: 14 }
      }
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: DS_COLORS.ink,
          fontSize: 12,
          fontWeight: 500,
          borderRadius: DS_RADII.sm,
          padding: '6px 8px'
        },
        arrow: { color: DS_COLORS.ink }
      }
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: DS_RADII.sm,
          backgroundColor: DS_COLORS.canvas,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: DS_COLORS.hairline
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: DS_COLORS.hairlineStrong
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: DS_COLORS.ink,
            borderWidth: 1
          },
          '&.Mui-focused': {
            boxShadow: '0 0 0 3px rgba(0,0,0,0.06)'
          }
        }
      }
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { backgroundColor: DS_COLORS.ink, height: 2 }
      }
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          color: DS_COLORS.body,
          '&.Mui-selected': { color: DS_COLORS.ink }
        }
      }
    },
    MuiSlider: {
      styleOverrides: {
        rail: { backgroundColor: DS_COLORS.hairline, opacity: 1 },
        thumb: {
          width: 14,
          height: 14,
          boxShadow: 'none',
          '&:hover, &.Mui-focusVisible': {
            boxShadow: '0 0 0 6px rgba(0,0,0,0.06)'
          }
        }
      }
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: DS_COLORS.hairline }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 9999, fontWeight: 500 }
      }
    },
    MuiLink: {
      styleOverrides: {
        root: { color: DS_COLORS.link }
      }
    },
    MuiSvgIcon: {
      defaultProps: {
        color: 'action'
      },
      styleOverrides: {
        root: {
          width: 17,
          height: 17
        }
      }
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined'
      }
    }
  }
};

export const theme = createTheme(themeConfig);
