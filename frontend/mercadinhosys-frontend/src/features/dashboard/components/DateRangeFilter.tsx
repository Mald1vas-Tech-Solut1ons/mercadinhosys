/**
 * DateRangeFilter Component
 * 
 * Provides calendar-based date range picker with preset ranges.
 * Implements reactive filtering for dashboard metrics.
 * 
 * Requirements: AC 3.1
 * Task: 3.2.1 Create DateRangeFilter component
 */

import React, { useState } from 'react';
import './DateRangeFilter.css';
import { dataLocalISO } from '../../../utils/dataLocal';

interface DateRangeFilterProps {
  onDateRangeChange: (startDate: Date | undefined, endDate: Date | undefined) => void;
  startDate?: Date;
  endDate?: Date;
}

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  onDateRangeChange,
  startDate,
  endDate,
}) => {
  const [showCalendar, setShowCalendar] = useState(false);

  // Preset date ranges
  const presets = [
    {
      label: 'Today',
      getValue: () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return { start: today, end: new Date() };
      },
    },
    {
      label: 'Last 7 days',
      getValue: () => {
        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        return { start, end };
      },
    },
    {
      label: 'Last 30 days',
      getValue: () => {
        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0);
        return { start, end };
      },
    },
    {
      label: 'Last 90 days',
      getValue: () => {
        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - 90);
        start.setHours(0, 0, 0, 0);
        return { start, end };
      },
    },
    {
      label: 'This month',
      getValue: () => {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        return { start, end };
      },
    },
    {
      label: 'This year',
      getValue: () => {
        const today = new Date();
        const start = new Date(today.getFullYear(), 0, 1);
        const end = new Date(today.getFullYear(), 11, 31);
        end.setHours(23, 59, 59, 999);
        return { start, end };
      },
    },
  ];

  const handlePreset = (preset: any) => {
    const { start, end } = preset.getValue();
    onDateRangeChange(start, end);
  };

  const handleCustomStartDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    // "AAAA-MM-DD" sem hora é lido como meia-noite UTC (21h do dia anterior aqui); com hora é local.
    const newStart = new Date(`${e.target.value}T00:00:00`);
    onDateRangeChange(newStart, endDate);
  };

  const handleCustomEndDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEnd = new Date(`${e.target.value}T00:00:00`);
    newEnd.setHours(23, 59, 59, 999);
    onDateRangeChange(startDate, newEnd);
  };

  const formatDate = (date?: Date) => {
    if (!date) return '';
    return dataLocalISO(date);
  };

  return (
    <div className="date-range-filter">
      <div className="filter-header">
        <label>Date Range</label>
        <button
          className="toggle-button"
          onClick={() => setShowCalendar(!showCalendar)}
        >
          {showCalendar ? '▲' : '▼'}
        </button>
      </div>

      {showCalendar && (
        <div className="filter-content">
          <div className="presets">
            <div className="preset-label">Presets:</div>
            <div className="preset-buttons">
              {presets.map((preset, idx) => (
                <button
                  key={idx}
                  className="preset-btn"
                  onClick={() => handlePreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divider">or</div>

          <div className="custom-range">
            <div className="date-input-group">
              <label>From:</label>
              <input
                type="date"
                value={formatDate(startDate)}
                onChange={handleCustomStartDate}
              />
            </div>
            <div className="date-input-group">
              <label>To:</label>
              <input
                type="date"
                value={formatDate(endDate)}
                onChange={handleCustomEndDate}
              />
            </div>
          </div>
        </div>
      )}

      {startDate && endDate && (
        <div className="selected-range">
          {formatDate(startDate)} to {formatDate(endDate)}
        </div>
      )}
    </div>
  );
};
