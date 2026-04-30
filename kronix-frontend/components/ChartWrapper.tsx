'use client';

import dynamic from 'next/dynamic';
import React from 'react';

const Chart = dynamic(() => import('./Chart'), { 
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#131722] text-[#4dffb4]/40 font-mono text-xs">
      LOADING KRONIX ENGINE...
    </div>
  )
});

interface ChartWrapperProps {
  symbol?: string;
}

export default function ChartWrapper({ symbol = 'KXI' }: ChartWrapperProps) {
  return <Chart symbol={symbol} />;
}
