import { DS_COLORS, DS_DROP_SHADOWS } from 'src/styles/tokens';
import React from 'react';
import { Card, SxProps } from '@mui/material';
import { clickStopperProps } from 'src/utils';

interface Props {
  children: React.ReactNode;
  sx?: SxProps;
  style?: React.CSSProperties;
}

export const UiElement = ({ children, sx, style }: Props) => {
  return (
    <Card
      sx={{
        borderRadius: 2, // 12px with the 6px theme radius
        boxShadow: DS_DROP_SHADOWS[4],
        borderColor: DS_COLORS.hairline,
        p: 0,
        ...sx
      }}
      style={style}
      {...clickStopperProps}
    >
      {children}
    </Card>
  );
};
