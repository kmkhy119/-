'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  getDay, 
  isSameDay,
  addMonths,
  subMonths,
  isSameMonth,
  subDays,
  addDays
} from 'date-fns';
import { ja } from 'date-fns/locale';
import { 
  Calendar as CalendarIcon, 
  Users, 
  Settings, 
  Play, 
  Download, 
  Plus, 
  Trash2, 
  ChevronLeft, 
  ChevronRight,
  Check,
  X,
  AlertCircle,
  Maximize,
  Minimize,
  Edit2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

type ShiftType = 'work' | 'off' | 'request-off';

interface ShiftPattern {
  id: string;
  name: string;
  label: string;
  color: string;
  type: 'work' | 'off';
}

interface Staff {
  id: string;
  name: string;
  canDoDuty: boolean;
  canDoEarly700: boolean;
  canDoEarly745: boolean;
  canDoLate: boolean;
  isMaternityLeave: boolean;
  historicalDutyCount: number;
  historicalEarly700Count: number;
  historicalEarly745Count: number;
  historicalLateCount: number;
  targetOffCount: number;
}

interface ShiftData {
  [staffId: string]: {
    [dateStr: string]: string; // Stores pattern ID or 'request-off'
  };
}

interface DailyRequirement {
  [dateStr: string]: number;
}

// --- Constants ---

const INITIAL_STAFF_COUNT = 12;
const DEFAULT_DAILY_REQUIREMENT = 8;

// --- Holiday Logic ---

const getJapaneseHolidays = (year: number) => {
  const holidays: { [dateStr: string]: string } = {};

  // Fixed dates
  holidays[`${year}-01-01`] = '元日';
  holidays[`${year}-02-11`] = '建国記念の日';
  holidays[`${year}-02-23`] = '天皇誕生日';
  holidays[`${year}-04-29`] = '昭和の日';
  holidays[`${year}-05-03`] = '憲法記念日';
  holidays[`${year}-05-04`] = 'みどりの日';
  holidays[`${year}-05-05`] = 'こどもの日';
  holidays[`${year}-08-11`] = '山の日';
  holidays[`${year}-11-03`] = '文化の日';
  holidays[`${year}-11-23`] = '勤労感謝の日';

  // Happy Monday (2nd Monday)
  const getHappyMonday = (month: number, week: number) => {
    const firstDay = new Date(year, month - 1, 1);
    const firstMonday = (8 - getDay(firstDay)) % 7 || 7;
    const date = firstMonday + (week - 1) * 7;
    return format(new Date(year, month - 1, date), 'yyyy-MM-dd');
  };

  holidays[getHappyMonday(1, 2)] = '成人の日';
  holidays[getHappyMonday(7, 3)] = '海の日';
  holidays[getHappyMonday(9, 3)] = '敬老の日';
  holidays[getHappyMonday(10, 2)] = 'スポーツの日';

  // Vernal/Autumnal Equinox (Approximate)
  const vernalEquinox = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  holidays[`${year}-03-${vernalEquinox}`] = '春分の日';
  const autumnalEquinox = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  holidays[`${year}-09-${autumnalEquinox}`] = '秋分の日';

  return holidays;
};

interface PairConstraint {
  id: string;
  staffIds: string[];
}

interface Constraints {
  maxConsecutiveWork: number;
  dutyWeekendContinuous: boolean;
  earlyAfterDutyNormal: boolean;
  pairConstraints: PairConstraint[];
}

interface FixedAssignment {
  staffName: string;
  dayOfWeek?: number; // 0-6
  weekOfMonth?: number; // 1-5
  patternId: string;
  memo?: string;
}

export default function ShiftScheduler() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const holidays = useMemo(() => getJapaneseHolidays(currentDate.getFullYear()), [currentDate]);
  const [staffCount, setStaffCount] = useState(INITIAL_STAFF_COUNT);
  const [staffList, setStaffList] = useState<Staff[]>(
    Array.from({ length: INITIAL_STAFF_COUNT }, (_, i) => ({
      id: `staff-${i + 1}`,
      name: `スタッフ ${i + 1}`,
      canDoDuty: true,
      canDoEarly700: true,
      canDoEarly745: true,
      canDoLate: true,
      isMaternityLeave: false,
      historicalDutyCount: 0,
      historicalEarly700Count: 0,
      historicalEarly745Count: 0,
      historicalLateCount: 0,
      targetOffCount: 10 // Will be updated by useEffect
    }))
  );
  const [shiftData, setShiftData] = useState<ShiftData>({});
  const [dailyRequirements, setDailyRequirements] = useState<DailyRequirement>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // --- Fullscreen Logic ---
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((e) => {
        console.error(`Error attempting to enable full-screen mode: ${e.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };
  const [message, setMessage] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [constraints, setConstraints] = useState<Constraints>({
    maxConsecutiveWork: 5,
    dutyWeekendContinuous: true,
    earlyAfterDutyNormal: true,
    pairConstraints: [],
  });
  const [fixedAssignments, setFixedAssignments] = useState<FixedAssignment[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [fixedCells, setFixedCells] = useState<{[staffId: string]: {[dateStr: string]: boolean}}>({});
  const [newFixed, setNewFixed] = useState<Partial<FixedAssignment>>({
    staffName: '',
    patternId: 'normal',
    dayOfWeek: 1,
    memo: '',
  });
  const [shiftPatterns, setShiftPatterns] = useState<ShiftPattern[]>([
    { id: 'normal', name: '通常', label: '勤', color: 'bg-emerald-500', type: 'work' },
    { id: 'duty', name: '当番', label: '当', color: 'bg-rose-600', type: 'work' },
    { id: 'early700', name: '早番(7:00)', label: '⑦', color: 'bg-amber-500', type: 'work' },
    { id: 'early745', name: '早番(7:45)', label: '45', color: 'bg-orange-400', type: 'work' },
    { id: 'late', name: '遅番', label: '遅', color: 'bg-purple-500', type: 'work' },
    { id: 'off', name: '公休', label: '休', color: 'bg-slate-200', type: 'off' },
    { id: 'paid-leave', name: '年休', label: '年', color: 'bg-slate-200', type: 'off' },
    { id: 'request-off', name: '希望休み', label: '希', color: 'bg-slate-200', type: 'off' },
    { id: 'maternity-leave', name: '産休', label: '産', color: 'bg-pink-100', type: 'off' },
    { id: 'sick-long-term', name: '病欠・長期', label: '病', color: 'bg-orange-100', type: 'off' },
  ]);
  const [longTermLeaves, setLongTermLeaves] = useState<{
    id: string;
    staffId: string;
    patternId: string;
    startDate: string;
    endDate: string;
  }[]>([]);
  const [newPair, setNewPair] = useState<string[]>(['', '']);
  const [selectedCell, setSelectedCell] = useState<{ staffId: string; dateStr: string } | null>(null);

  // --- Date Helpers ---

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const daysInMonth = useMemo(() => eachDayOfInterval({ start: monthStart, end: monthEnd }), [monthStart, monthEnd]);

  const defaultOffCount = useMemo(() => {
    return daysInMonth.filter(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayOfWeek = getDay(day);
      const isHoliday = !!holidays[dateStr];
      return dayOfWeek === 0 || dayOfWeek === 6 || isHoliday;
    }).length;
  }, [daysInMonth, holidays]);

  useEffect(() => {
    setStaffList(prev => prev.map(s => ({ ...s, targetOffCount: defaultOffCount })));
  }, [defaultOffCount]);

  const getDayName = (date: Date) => format(date, 'E', { locale: ja });
  const isWeekend = (date: Date) => {
    const day = getDay(date);
    return day === 0 || day === 6;
  };

  // --- Handlers ---

  const handleCellClick = (staffId: string, date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    setSelectedCell({ staffId, dateStr });
  };

  const assignShift = (staffId: string, dateStr: string, patternId: string | 'request-off' | 'clear') => {
    setShiftData(prev => {
      const staffShifts = { ...(prev[staffId] || {}) };
      if (patternId === 'clear') {
        delete staffShifts[dateStr];
      } else {
        staffShifts[dateStr] = patternId;
      }
      return { ...prev, [staffId]: staffShifts };
    });
    setSelectedCell(null);
  };

  const updateRequirement = (date: Date, value: string) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const num = parseInt(value) || 0;
    setDailyRequirements(prev => ({
      ...prev,
      [dateStr]: num
    }));
  };

  const handlePrevMonth = () => setCurrentDate(prev => subMonths(prev, 1));
  const handleNextMonth = () => {
    // Update historical counts before moving to next month
    setStaffList(prev => prev.map(staff => {
      const stats = getStaffStats(staff.id);
      return {
        ...staff,
        historicalDutyCount: staff.historicalDutyCount + stats.duty,
        historicalEarly700Count: staff.historicalEarly700Count + stats.early700,
        historicalEarly745Count: staff.historicalEarly745Count + stats.early745,
        historicalLateCount: staff.historicalLateCount + stats.late,
      };
    }));
    setCurrentDate(prev => addMonths(prev, 1));
  };

  // --- Scheduling Algorithm ---

  const generateShifts = async () => {
    setIsGenerating(true);
    setMessage({ text: '勤務表を作成中...', type: 'info' });

    await new Promise(resolve => setTimeout(resolve, 800));

    try {
      const newShiftData = { ...shiftData };
      const latePattern = 'late';
      const early700Pattern = 'early700';
      const early745Pattern = 'early745';
      const dutyPattern = 'duty';
      const normalPattern = 'normal';
      
      // Initialize
      staffList.forEach(staff => {
        if (!newShiftData[staff.id]) newShiftData[staff.id] = {};
        daysInMonth.forEach(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const dayOfWeek = getDay(day);
          const isHoliday = !!holidays[dateStr];
          const isSunday = dayOfWeek === 0;
          
          const current = newShiftData[staff.id][dateStr];
          
          if (current !== 'request-off' && current !== 'maternity-leave' && current !== 'sick-long-term' && current !== 'paid-leave') {
            newShiftData[staff.id][dateStr] = normalPattern;
          }
        });
      });

      // 1. Apply Fixed Assignments
      const newFixedCells: {[staffId: string]: {[dateStr: string]: boolean}} = {};
      daysInMonth.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayOfWeek = getDay(day);
        const dayOfMonth = day.getDate();
        const weekOfMonth = Math.ceil(dayOfMonth / 7);

        fixedAssignments.forEach(fixed => {
          const staff = staffList.find(s => s.name === fixed.staffName);
          if (!staff) return;

          let match = false;
          if (fixed.dayOfWeek !== undefined && fixed.dayOfWeek === dayOfWeek) {
            if (fixed.weekOfMonth !== undefined) {
              if (fixed.weekOfMonth === weekOfMonth) match = true;
            } else {
              match = true;
            }
          }

          if (match && newShiftData[staff.id][dateStr] !== 'request-off') {
            newShiftData[staff.id][dateStr] = fixed.patternId;
            if (!newFixedCells[staff.id]) newFixedCells[staff.id] = {};
            newFixedCells[staff.id][dateStr] = true;
          }
        });
      });
      setFixedCells(newFixedCells);

      // Track consecutive days
      const consecutiveTracker: { [id: string]: number } = {};
      staffList.forEach(s => consecutiveTracker[s.id] = 0);

      // 2. Assign Duty (1 per day, Sat/Sun continuous)
      let weekendDutyStaffId: string | null = null;

      daysInMonth.forEach((day, idx) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayOfWeek = getDay(day);
        
        // Check if someone is already assigned duty (fixed)
        let assignedDuty = staffList.find(s => newShiftData[s.id][dateStr] === dutyPattern);
        
        if (!assignedDuty) {
          let candidate: Staff | undefined;

          if (dayOfWeek === 0 && weekendDutyStaffId && constraints.dutyWeekendContinuous) {
            // Sunday - use Saturday's person if possible
            const satPerson = staffList.find(s => s.id === weekendDutyStaffId);
            if (satPerson && newShiftData[satPerson.id][dateStr] !== 'request-off') {
              candidate = satPerson;
            }
          }

          if (!candidate) {
            // Pick new duty person
            const available = staffList.filter(s => 
              s.canDoDuty &&
              newShiftData[s.id][dateStr] !== 'request-off' && 
              !newFixedCells[s.id]?.[dateStr] && // Don't pick if already has a fixed assignment
              (newShiftData[s.id][dateStr] === 'off' || newShiftData[s.id][dateStr] === normalPattern)
            );
            
            // Sort by total shifts to balance (historical + current month) with some randomness
            available.sort((a, b) => {
              const countA = a.historicalDutyCount + Object.values(newShiftData[a.id]).filter(v => v === dutyPattern).length;
              const countB = b.historicalDutyCount + Object.values(newShiftData[b.id]).filter(v => v === dutyPattern).length;
              if (countA !== countB) return countA - countB;
              return Math.random() - 0.5;
            });

            candidate = available[0];
          }

          if (candidate) {
            newShiftData[candidate.id][dateStr] = dutyPattern;
            if (dayOfWeek === 6) weekendDutyStaffId = candidate.id;

            // Force normal shift on the next day if it's not a request-off
            if (idx < daysInMonth.length - 1) {
              const nextDay = daysInMonth[idx + 1];
              const nextDateStr = format(nextDay, 'yyyy-MM-dd');
              if (newShiftData[candidate.id][nextDateStr] !== 'request-off') {
                newShiftData[candidate.id][nextDateStr] = normalPattern;
              }
            }
          }
        } else {
          if (dayOfWeek === 6) weekendDutyStaffId = assignedDuty.id;
          
          // Force normal shift on the next day for fixed duty too
          if (idx < daysInMonth.length - 1) {
            const nextDay = daysInMonth[idx + 1];
            const nextDateStr = format(nextDay, 'yyyy-MM-dd');
            if (newShiftData[assignedDuty.id][nextDateStr] !== 'request-off') {
              newShiftData[assignedDuty.id][nextDateStr] = normalPattern;
            }
          }
        }
      });

      // 3. Assign Early Shifts (Mondays: 7:00 & 7:45, Other days: 7:45)
      daysInMonth.forEach((day, idx) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const prevDateStr = idx > 0 ? format(daysInMonth[idx-1], 'yyyy-MM-dd') : null;
        const dayOfWeek = getDay(day);
        
        if (dayOfWeek === 0) return; // No early shifts on Sunday

        // Mondays require both early shifts, other days only 7:45
        const patternsToAssign = dayOfWeek === 1 ? [early700Pattern, early745Pattern] : [early745Pattern];
        
        patternsToAssign.forEach(patternId => {
          // Check if someone is already assigned this specific early shift (fixed)
          let alreadyAssigned = staffList.find(s => newShiftData[s.id][dateStr] === patternId);
          
          if (!alreadyAssigned) {
            const available = staffList.filter(s => 
              (patternId === early700Pattern ? s.canDoEarly700 : s.canDoEarly745) &&
              (newShiftData[s.id][dateStr] === 'off' || newShiftData[s.id][dateStr] === normalPattern) &&
              newShiftData[s.id][dateStr] !== 'request-off' &&
              !newFixedCells[s.id]?.[dateStr] && // Don't pick if already has a fixed assignment
              // Day after duty must be normal shift (so not early)
              !(prevDateStr && newShiftData[s.id][prevDateStr] === dutyPattern)
            );

            available.sort((a, b) => {
              const countA = Object.values(newShiftData[a.id]).filter(v => v === early700Pattern || v === early745Pattern).length;
              const countB = Object.values(newShiftData[b.id]).filter(v => v === early700Pattern || v === early745Pattern).length;
              if (countA !== countB) return countA - countB;
              return Math.random() - 0.5;
            });

            if (available.length > 0) {
              newShiftData[available[0].id][dateStr] = patternId;
            }
          }
        });
      });

      // 4. Assign Late Shifts (1 person every day except Sundays/Holidays)
      daysInMonth.forEach((day, idx) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const prevDateStr = idx > 0 ? format(daysInMonth[idx-1], 'yyyy-MM-dd') : null;
        const dayOfWeek = getDay(day);
        if (dayOfWeek === 0) return;

        // Check if someone is already assigned late shift (fixed)
        let alreadyAssigned = staffList.find(s => newShiftData[s.id][dateStr] === latePattern);
        
        if (!alreadyAssigned) {
          const available = staffList.filter(s => 
            s.canDoLate &&
            (newShiftData[s.id][dateStr] === 'off' || newShiftData[s.id][dateStr] === normalPattern) &&
            newShiftData[s.id][dateStr] !== 'request-off' &&
            !newFixedCells[s.id]?.[dateStr] && // Don't pick if already has a fixed assignment
            // Day after duty must be normal shift (so not late)
            !(prevDateStr && newShiftData[s.id][prevDateStr] === dutyPattern)
          );

          available.sort((a, b) => {
            const countA = Object.values(newShiftData[a.id]).filter(v => v === latePattern).length;
            const countB = Object.values(newShiftData[b.id]).filter(v => v === latePattern).length;
            if (countA !== countB) return countA - countB;
            return Math.random() - 0.5;
          });

          if (available.length > 0) {
            newShiftData[available[0].id][dateStr] = latePattern;
          }
        }
      });

      // Helper to get daily count from the new data being built
      const getNewDailyCount = (date: Date, currentData: ShiftData) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        let count = 0;
        staffList.forEach(staff => {
          const shiftId = currentData[staff.id]?.[dateStr];
          const pattern = shiftPatterns.find(p => p.id === shiftId);
          if (pattern?.type === 'work') count++;
        });
        return count;
      };

      // Helper to check consecutive work days
      const getConsecutiveWork = (staffId: string, date: Date, currentData: ShiftData) => {
        let count = 0;
        // Check backwards
        let curr = subDays(date, 1);
        while (isSameMonth(curr, currentDate)) {
          const dStr = format(curr, 'yyyy-MM-dd');
          const p = shiftPatterns.find(pat => pat.id === currentData[staffId]?.[dStr]);
          if (p?.type === 'work') {
            count++;
            curr = subDays(curr, 1);
          } else break;
        }
        // Check forwards
        curr = addDays(date, 1);
        while (isSameMonth(curr, currentDate)) {
          const dStr = format(curr, 'yyyy-MM-dd');
          const p = shiftPatterns.find(pat => pat.id === currentData[staffId]?.[dStr]);
          if (p?.type === 'work') {
            count++;
            curr = addDays(curr, 1);
          } else break;
        }
        return count;
      };

      // 5. Adjust to meet daily requirements
      daysInMonth.forEach((day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayOfWeek = getDay(day);
        const required = dailyRequirements[dateStr] ?? (dayOfWeek === 0 ? 0 : DEFAULT_DAILY_REQUIREMENT);
        
        let currentWorking = staffList.filter(s => {
          const p = shiftPatterns.find(pat => pat.id === newShiftData[s.id][dateStr]);
          return p?.type === 'work';
        });

        if (currentWorking.length < required) {
          // Need more people
          let available = staffList.filter(s => 
            newShiftData[s.id][dateStr] === 'off' || !newShiftData[s.id][dateStr]
          );

          // Sort by current off count (descending) to pick those who have too many off days
          available.sort((a, b) => {
            const offA = Object.values(newShiftData[a.id]).filter(v => shiftPatterns.find(p => p.id === v)?.type === 'off' || !v).length;
            const offB = Object.values(newShiftData[b.id]).filter(v => shiftPatterns.find(p => p.id === v)?.type === 'off' || !v).length;
            if (offA !== offB) return offB - offA;
            return Math.random() - 0.5;
          });

          for (let i = 0; i < Math.min(required - currentWorking.length, available.length); i++) {
            newShiftData[available[i].id][dateStr] = normalPattern;
          }
        }
      });

      // 6. Final Adjustment: Strictly match target off count for each staff
      staffList.forEach(staff => {
        const currentOffCount = daysInMonth.filter(day => {
          const val = newShiftData[staff.id][format(day, 'yyyy-MM-dd')];
          const pattern = shiftPatterns.find(p => p.id === val);
          return pattern?.type === 'off' || !val;
        }).length;
        
        const diff = currentOffCount - staff.targetOffCount;

        if (diff > 0) {
          // Too many off days, convert some 'off' to 'normal'
          const offDays = daysInMonth.filter(day => {
            const val = newShiftData[staff.id][format(day, 'yyyy-MM-dd')];
            return val === 'off' || !val;
          });
          
          // Prioritize days with low staff count, but avoid weekends/holidays if possible
          // Also avoid creating long consecutive work chains
          offDays.sort((a, b) => {
            const dateA = format(a, 'yyyy-MM-dd');
            const dateB = format(b, 'yyyy-MM-dd');
            const isWHA = getDay(a) === 0 || getDay(a) === 6 || !!holidays[dateA];
            const isWHB = getDay(b) === 0 || getDay(b) === 6 || !!holidays[dateB];
            
            // 1. Avoid violating max consecutive work
            const consA = getConsecutiveWork(staff.id, a, newShiftData);
            const consB = getConsecutiveWork(staff.id, b, newShiftData);
            if (consA !== consB) return consA - consB; // Lower consecutive work first
            
            if (isWHA !== isWHB) return isWHA ? 1 : -1; // Weekdays first
            
            const countDiff = getNewDailyCount(a, newShiftData) - getNewDailyCount(b, newShiftData);
            if (countDiff !== 0) return countDiff;
            return Math.random() - 0.5;
          });
          
          for (let i = 0; i < diff && i < offDays.length; i++) {
            newShiftData[staff.id][format(offDays[i], 'yyyy-MM-dd')] = normalPattern;
          }
        } else if (diff < 0) {
          // Too few off days, convert some 'normal' to 'off'
          const workDays = daysInMonth.filter(day => newShiftData[staff.id][format(day, 'yyyy-MM-dd')] === normalPattern);
          
          // Prioritize days with high staff count, favor weekends/holidays,
          // and prioritize breaking long consecutive work chains
          workDays.sort((a, b) => {
            const dateA = format(a, 'yyyy-MM-dd');
            const dateB = format(b, 'yyyy-MM-dd');
            const isWHA = getDay(a) === 0 || getDay(a) === 6 || !!holidays[dateA];
            const isWHB = getDay(b) === 0 || getDay(b) === 6 || !!holidays[dateB];
            
            // 1. Prioritize breaking long consecutive work chains
            const consA = getConsecutiveWork(staff.id, a, newShiftData);
            const consB = getConsecutiveWork(staff.id, b, newShiftData);
            if (consA !== consB) return consB - consA; // Higher consecutive work first
            
            // 2. Prioritize days with surplus staff relative to requirements
            const reqA = dailyRequirements[dateA] ?? (getDay(a) === 0 ? 0 : DEFAULT_DAILY_REQUIREMENT);
            const reqB = dailyRequirements[dateB] ?? (getDay(b) === 0 ? 0 : DEFAULT_DAILY_REQUIREMENT);
            const surplusA = getNewDailyCount(a, newShiftData) - reqA;
            const surplusB = getNewDailyCount(b, newShiftData) - reqB;
            if (surplusA !== surplusB) return surplusB - surplusA;

            if (isWHA !== isWHB) return isWHA ? -1 : 1; // Weekends/Holidays first
            return Math.random() - 0.5;
          });

          for (let i = 0; i < Math.abs(diff) && i < workDays.length; i++) {
            newShiftData[staff.id][format(workDays[i], 'yyyy-MM-dd')] = 'off';
          }
        }
      });

      // 7. Apply Pair Constraints (Ensure at least one of the pair works)
      constraints.pairConstraints.forEach(pair => {
        const activeStaffIds = pair.staffIds.filter(id => id !== '');
        if (activeStaffIds.length < 2) return;

        daysInMonth.forEach(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const dayOfWeek = getDay(day);
          if (dayOfWeek === 0) return; // Skip Sundays

          const workingStaff = activeStaffIds.filter(id => {
            const shiftId = newShiftData[id]?.[dateStr];
            return shiftPatterns.find(p => p.id === shiftId)?.type === 'work';
          });

          if (workingStaff.length === 0) {
            // None of the selected staff are working. Force one to work.
            const candidates = activeStaffIds
              .filter(id => newShiftData[id][dateStr] !== 'request-off' && newShiftData[id][dateStr] !== 'paid-leave')
              .sort((a, b) => {
                const countA = Object.values(newShiftData[a]).filter(v => shiftPatterns.find(p => p.id === v)?.type === 'work').length;
                const countB = Object.values(newShiftData[b]).filter(v => shiftPatterns.find(p => p.id === v)?.type === 'work').length;
                return countA - countB;
              });

            if (candidates.length > 0) {
              // Add randomness to candidate selection
              candidates.sort(() => Math.random() - 0.5);
              newShiftData[candidates[0]][dateStr] = normalPattern;
            }
          }
        });
      });

      // 8. Final Sweep: Force break any remaining max consecutive work violations
      staffList.forEach(staff => {
        let consecutive = 0;
        daysInMonth.forEach((day, idx) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const p = shiftPatterns.find(pat => pat.id === newShiftData[staff.id][dateStr]);
          
          if (p?.type === 'work') {
            consecutive++;
            if (consecutive > constraints.maxConsecutiveWork) {
              // Violation! Try to find a nearby 'off' day to swap with, or just force 'off'
              // For simplicity, we force 'off' if it's not a fixed assignment or request
              const currentVal = newShiftData[staff.id][dateStr];
              if (currentVal === normalPattern && !newFixedCells[staff.id]?.[dateStr]) {
                newShiftData[staff.id][dateStr] = 'off';
                consecutive = 0;
              }
            }
          } else {
            consecutive = 0;
          }
        });
      });

      setShiftData(newShiftData);
      setMessage({ text: '勤務表の作成が完了しました！', type: 'success' });
    } catch (err) {
      console.error(err);
      setMessage({ text: 'エラーが発生しました。', type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  };

  const exportToCSV = () => {
    const headers = ['スタッフ', ...daysInMonth.map(d => format(d, 'd')), '休み数', '当番数', '⑦数', '45数', '通常数', '遅番数', '産休数', '病欠・長期数'];
    const rows = staffList.map(staff => {
      const row = [staff.name];
      daysInMonth.forEach(day => {
        const shiftId = shiftData[staff.id]?.[format(day, 'yyyy-MM-dd')];
        const pattern = shiftPatterns.find(p => p.id === shiftId);
        row.push(shiftId === 'request-off' ? '希' : pattern?.label || '休');
      });
      const stats = getStaffStats(staff.id);
      row.push(stats.off.toString());
      row.push(stats.duty.toString());
      row.push(stats.early700.toString());
      row.push(stats.early745.toString());
      row.push(stats.normal.toString());
      row.push(stats.late.toString());
      row.push(stats.maternityLeave.toString());
      row.push(stats.sickLongTerm.toString());
      return row.join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `shift_schedule_${format(currentDate, 'yyyyMM')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const addFixedAssignment = () => {
    if (!newFixed.staffName || !newFixed.patternId) return;
    
    if (editingIndex !== null) {
      setFixedAssignments(prev => {
        const updated = [...prev];
        updated[editingIndex] = newFixed as FixedAssignment;
        return updated;
      });
      setEditingIndex(null);
      setMessage({ text: '固定出勤を更新しました。', type: 'success' });
    } else {
      setFixedAssignments(prev => [...prev, newFixed as FixedAssignment]);
      setMessage({ text: '固定出勤を追加しました。', type: 'success' });
    }
    
    setNewFixed(prev => ({ ...prev, memo: '' }));
  };

  const editFixedAssignment = (index: number) => {
    setNewFixed(fixedAssignments[index]);
    setEditingIndex(index);
  };

  const removeFixedAssignment = (index: number) => {
    setFixedAssignments(prev => prev.filter((_, i) => i !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      setNewFixed(prev => ({ ...prev, memo: '' }));
    }
  };

  const handleStaffCountChange = (value: string) => {
    const newCount = Math.max(1, Math.min(50, parseInt(value) || 1));
    setStaffCount(newCount);
    setStaffList(prev => {
      if (newCount > prev.length) {
        const additional = Array.from({ length: newCount - prev.length }, (_, i) => ({
          id: `staff-${prev.length + i + 1}`,
          name: `スタッフ ${prev.length + i + 1}`,
          canDoDuty: true,
          canDoEarly700: true,
          canDoEarly745: true,
          canDoLate: true,
          isMaternityLeave: false,
          historicalDutyCount: 0,
          historicalEarly700Count: 0,
          historicalEarly745Count: 0,
          historicalLateCount: 0,
          targetOffCount: defaultOffCount
        }));
        return [...prev, ...additional];
      } else {
        return prev.slice(0, newCount);
      }
    });
  };

  const resetShifts = (includeRequests = false) => {
    const newShiftData = { ...shiftData };
    staffList.forEach(staff => {
      if (newShiftData[staff.id]) {
        if (includeRequests) {
          newShiftData[staff.id] = {};
        } else {
          Object.keys(newShiftData[staff.id]).forEach(dateStr => {
            const shiftId = newShiftData[staff.id][dateStr];
            if (shiftId === 'request-off') return;
            newShiftData[staff.id][dateStr] = 'off';
          });
        }
      }
    });
    setShiftData(newShiftData);
    setMessage({ 
      text: includeRequests ? 'すべてのデータをリセットしました。' : '勤務表をリセットしました（希望休は維持）。', 
      type: 'success' 
    });
  };

  // --- Effects ---

  // Initialize shiftData skeleton but keep cells empty (Clear) by default
  useEffect(() => {
    setShiftData(prev => {
      const newShiftData = { ...prev };
      let changed = false;
      
      staffList.forEach(staff => {
        if (!newShiftData[staff.id]) {
          newShiftData[staff.id] = {};
          changed = true;
        }
        
        daysInMonth.forEach(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          if (!newShiftData[staff.id][dateStr]) {
            if (staff.isMaternityLeave) {
              newShiftData[staff.id][dateStr] = 'maternity-leave';
              changed = true;
            }
            // Keep other cells empty (Clear)
          }
        });
      });
      
      return changed ? newShiftData : prev;
    });
  }, [staffList, daysInMonth]);

  const getDailyCount = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    let count = 0;
    staffList.forEach(staff => {
      const shiftId = shiftData[staff.id]?.[dateStr];
      const pattern = shiftPatterns.find(p => p.id === shiftId);
      if (pattern?.type === 'work') count++;
    });
    return count;
  };
  const getStaffStats = (staffId: string) => {
    const stats = {
      off: 0,
      duty: 0,
      early700: 0,
      early745: 0,
      normal: 0,
      late: 0,
      paidLeave: 0,
      requestOff: 0,
      maternityLeave: 0,
      sickLongTerm: 0,
    };
    
    const staffShifts = shiftData[staffId] || {};
    daysInMonth.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const shiftId = staffShifts[dateStr];
      
      const pattern = shiftPatterns.find(p => p.id === shiftId);
      if (pattern?.type === 'off' || !shiftId) stats.off++;
      
      if (shiftId === 'duty') stats.duty++;
      if (shiftId === 'early700') stats.early700++;
      if (shiftId === 'early745') stats.early745++;
      if (shiftId === 'normal') stats.normal++;
      if (shiftId === 'late') stats.late++;
      if (shiftId === 'paid-leave') stats.paidLeave++;
      if (shiftId === 'request-off') stats.requestOff++;
      if (shiftId === 'maternity-leave') stats.maternityLeave++;
      if (shiftId === 'sick-long-term') stats.sickLongTerm++;
    });
    return stats;
  };

  return (
    <div className={`h-screen bg-slate-50 flex flex-col overflow-hidden ${isFullscreen ? 'p-0' : 'p-0 sm:p-2 md:p-4'}`}>
      <div className={`w-full flex-1 flex flex-col overflow-hidden ${isFullscreen ? 'space-y-0' : 'space-y-2'}`}>
        
        {/* Header */}
        <header className={`flex flex-col md:flex-row md:items-center justify-between gap-2 bg-white px-3 py-1.5 shadow-sm border-b border-slate-200 shrink-0 ${isFullscreen ? 'rounded-none' : 'rounded-none sm:rounded-xl sm:border'}`}>
          <div className="flex items-center gap-2">
            <div className="p-1 bg-indigo-600 rounded text-white">
              <CalendarIcon size={16} />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-none">勤務表作成ツール</h1>
              <p className="text-[9px] text-indigo-600 font-bold leading-none mt-0.5">A作成</p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md">
            <button 
              onClick={handlePrevMonth}
              className="p-0.5 hover:bg-white hover:shadow-sm rounded transition-all"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-1.5 font-bold text-[11px] min-w-[90px] text-center">
              {format(currentDate, 'yyyy年 MM月', { locale: ja })}
            </span>
            <button 
              onClick={handleNextMonth}
              className="p-0.5 hover:bg-white hover:shadow-sm rounded transition-all"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button 
              onClick={toggleFullscreen}
              className="p-1 text-slate-500 hover:bg-slate-100 rounded transition-colors"
              title={isFullscreen ? "縮小" : "全画面表示"}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
            <button 
              onClick={exportToCSV}
              className="p-1 text-slate-500 hover:bg-slate-100 rounded transition-colors"
              title="CSVダウンロード"
            >
              <Download size={16} />
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-1 text-slate-500 hover:bg-slate-100 rounded transition-colors"
              title="条件設定"
            >
              <Settings size={16} />
            </button>
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <button 
              onClick={() => resetShifts(false)}
              className="px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-100 rounded transition-colors"
            >
              リセット
            </button>
            <button 
              onClick={generateShifts}
              disabled={isGenerating}
              className="flex items-center gap-1 px-3 py-1 bg-indigo-600 text-white rounded text-[10px] font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm"
            >
              {isGenerating ? (
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Play size={12} fill="currentColor" />
              )}
              自動作成
            </button>
          </div>
        </header>

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-2xl p-6 w-full max-w-5xl max-h-[90vh] overflow-y-auto shadow-2xl space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Settings size={20} className="text-indigo-600" />
                    作成条件の設定
                  </h2>
                  <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-slate-100 rounded">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Fixed Assignments Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <Users size={16} className="text-indigo-600" />
                      固定出勤の設定
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="grid grid-cols-2 gap-2">
                          <select 
                            value={newFixed.staffName}
                            onChange={(e) => setNewFixed(prev => ({ ...prev, staffName: e.target.value }))}
                            className="text-xs p-2 border border-slate-200 rounded bg-white"
                          >
                            <option value="">スタッフを選択</option>
                            {staffList.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                          </select>
                          <select 
                            value={newFixed.patternId}
                            onChange={(e) => setNewFixed(prev => ({ ...prev, patternId: e.target.value }))}
                            className="text-xs p-2 border border-slate-200 rounded bg-white"
                          >
                            {shiftPatterns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <select 
                            value={newFixed.dayOfWeek}
                            onChange={(e) => setNewFixed(prev => ({ ...prev, dayOfWeek: parseInt(e.target.value) }))}
                            className="text-xs p-2 border border-slate-200 rounded bg-white"
                          >
                            {['日', '月', '火', '水', '木', '金', '土'].map((day, i) => (
                              <option key={i} value={i}>{day}曜日</option>
                            ))}
                          </select>
                          <select 
                            value={newFixed.weekOfMonth === undefined ? '' : newFixed.weekOfMonth}
                            onChange={(e) => setNewFixed(prev => ({ ...prev, weekOfMonth: e.target.value === '' ? undefined : parseInt(e.target.value) }))}
                            className="text-xs p-2 border border-slate-200 rounded bg-white"
                          >
                            <option value="">毎週</option>
                            <option value="1">第1週</option>
                            <option value="2">第2週</option>
                            <option value="3">第3週</option>
                            <option value="4">第4週</option>
                            <option value="5">第5週</option>
                          </select>
                          <input 
                            type="text"
                            placeholder="目的・メモ"
                            value={newFixed.memo || ''}
                            onChange={(e) => setNewFixed(prev => ({ ...prev, memo: e.target.value }))}
                            className="text-xs p-2 border border-slate-200 rounded bg-white"
                          />
                        </div>
                        <button 
                          onClick={addFixedAssignment}
                          className={`w-full py-2 text-xs font-bold rounded transition-colors ${editingIndex !== null ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                        >
                          {editingIndex !== null ? '更新する' : '追加する'}
                        </button>
                        {editingIndex !== null && (
                          <button 
                            onClick={() => {
                              setEditingIndex(null);
                              setNewFixed({
                                staffName: '',
                                patternId: 'normal',
                                dayOfWeek: 1,
                                memo: '',
                              });
                            }}
                            className="w-full py-1 text-[10px] text-slate-400 hover:text-slate-600"
                          >
                            キャンセル
                          </button>
                        )}
                      </div>

                      <div className="max-h-[300px] overflow-y-auto space-y-2 border border-slate-100 rounded-xl p-2">
                        {fixedAssignments.length === 0 ? (
                          <div className="text-center py-8 text-slate-400 text-xs italic">
                            設定済みの固定勤務はありません
                          </div>
                        ) : (
                          fixedAssignments.map((fixed, i) => (
                            <div key={i} className={`flex items-center justify-between p-2 border rounded text-xs shadow-sm transition-colors ${editingIndex === i ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'}`}>
                              <div className="flex flex-col gap-1 w-full mr-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-700">{fixed.staffName}</span>
                                  <span className="text-slate-400">|</span>
                                  <span>
                                    {fixed.weekOfMonth ? `第${fixed.weekOfMonth}` : '毎週'}
                                    {['日', '月', '火', '水', '木', '金', '土'][fixed.dayOfWeek || 0]}曜
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] text-white ${shiftPatterns.find(p => p.id === fixed.patternId)?.color}`}>
                                    {shiftPatterns.find(p => p.id === fixed.patternId)?.label}
                                  </span>
                                </div>
                                {fixed.memo && (
                                  <div className="text-[10px] text-slate-400 italic">
                                    {fixed.memo}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <button onClick={() => editFixedAssignment(i)} className="p-1 text-slate-300 hover:text-indigo-500 flex-shrink-0 transition-colors">
                                  <Edit2 size={14} />
                                </button>
                                <button onClick={() => removeFixedAssignment(i)} className="p-1 text-slate-300 hover:text-rose-500 flex-shrink-0 transition-colors">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-3">
                      <label className="text-sm font-semibold text-slate-700 whitespace-nowrap">スタッフ人数</label>
                      <input 
                        type="number"
                        min="1"
                        max="30"
                        value={staffCount}
                        onChange={(e) => handleStaffCountChange(e.target.value)}
                        className="w-20 p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm font-semibold text-slate-700 whitespace-nowrap">最大連勤数</label>
                      <input 
                        type="number"
                        min="1"
                        value={constraints.maxConsecutiveWork}
                        onChange={(e) => setConstraints(prev => ({ ...prev, maxConsecutiveWork: parseInt(e.target.value) || 1 }))}
                        className="w-20 p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-semibold text-slate-700">ペア出勤条件</label>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-end gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="flex-1 min-w-[120px] space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold ml-1">スタッフ1</label>
                          <select 
                            value={newPair[0]}
                            onChange={(e) => setNewPair(prev => [e.target.value, prev[1]])}
                            className="w-full text-xs p-2 border border-slate-200 rounded bg-white"
                          >
                            <option value="">スタッフを選択</option>
                            {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                        <div className="flex-1 min-w-[120px] space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold ml-1">スタッフ2</label>
                          <select 
                            value={newPair[1]}
                            onChange={(e) => setNewPair(prev => [prev[0], e.target.value])}
                            className="w-full text-xs p-2 border border-slate-200 rounded bg-white"
                          >
                            <option value="">スタッフを選択</option>
                            {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                        <button 
                          onClick={() => {
                            if (!newPair[0] || !newPair[1]) {
                              setMessage({ text: '2人のスタッフを選択してください。', type: 'error' });
                              return;
                            }
                            if (newPair[0] === newPair[1]) {
                              setMessage({ text: '異なるスタッフを選択してください。', type: 'error' });
                              return;
                            }
                            const id = `pair-${Date.now()}`;
                            setConstraints(prev => ({
                              ...prev,
                              pairConstraints: [...prev.pairConstraints, { id, staffIds: [...newPair] }]
                            }));
                            setNewPair(['', '']);
                            setMessage({ text: 'ペアを追加しました。', type: 'success' });
                          }}
                          className="px-4 py-2 text-xs font-bold bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors h-[34px]"
                        >
                          追加
                        </button>
                      </div>

                      <div className="max-h-[120px] overflow-y-auto space-y-2 border border-slate-100 rounded-xl p-1.5 bg-slate-50/30">
                        {constraints.pairConstraints.length === 0 ? (
                          <div className="text-center py-4 text-slate-400 text-[10px] italic">
                            設定済みのペアはありません
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                            {constraints.pairConstraints.map((pair) => (
                              <div key={pair.id} className="flex items-center justify-between px-2 py-1 bg-white border border-slate-100 rounded shadow-sm">
                                <div className="flex items-center gap-1.5 overflow-hidden">
                                  <span className="font-bold text-slate-700 text-[10px] truncate">
                                    {staffList.find(s => s.id === pair.staffIds[0])?.name}
                                  </span>
                                  <span className="text-slate-300">×</span>
                                  <span className="font-bold text-slate-700 text-[10px] truncate">
                                    {staffList.find(s => s.id === pair.staffIds[1])?.name}
                                  </span>
                                </div>
                                <button 
                                  onClick={() => {
                                    setConstraints(prev => ({
                                      ...prev,
                                      pairConstraints: prev.pairConstraints.filter(p => p.id !== pair.id)
                                    }));
                                  }}
                                  className="p-0.5 text-slate-300 hover:text-rose-500 transition-colors ml-1"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 space-y-3">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">データリセット</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => resetShifts(false)}
                      className="py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                      勤務のみリセット
                    </button>
                    <button 
                      onClick={() => resetShifts(true)}
                      className="py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
                    >
                      すべてリセット
                    </button>
                  </div>
                </div>

                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors"
                >
                  設定を保存
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Shift Picker Modal */}
        <AnimatePresence>
          {selectedCell && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20" onClick={() => setSelectedCell(null)}>
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl p-4 shadow-2xl border border-slate-200 w-64 space-y-3"
              >
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">シフトを選択</h3>
                <div className="grid grid-cols-1 gap-2">
                  {shiftPatterns.map(pattern => (
                    <button 
                      key={pattern.id}
                      onClick={() => assignShift(selectedCell.staffId, selectedCell.dateStr, pattern.id)}
                      className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg transition-colors group"
                    >
                        <div className={`w-8 h-8 rounded-lg ${pattern.color} ${pattern.type === 'work' ? 'text-white' : (['paid-leave', 'request-off'].includes(pattern.id) ? 'text-rose-600' : 'text-slate-600')} flex items-center justify-center text-xs font-bold shadow-sm`}>
                        {pattern.label}
                      </div>
                      <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600">{pattern.name}</span>
                    </button>
                  ))}
                  <div className="h-px bg-slate-100 my-1" />
                  <button 
                    onClick={() => assignShift(selectedCell.staffId, selectedCell.dateStr, 'clear')}
                    className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg transition-colors text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 size={16} />
                    <span className="text-sm font-medium">クリア</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {message && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`p-4 rounded-xl flex items-center gap-3 border ${
                message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                message.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' :
                'bg-blue-50 border-blue-200 text-blue-800'
              }`}
            >
              {message.type === 'success' ? <Check size={20} /> : 
               message.type === 'error' ? <AlertCircle size={20} /> : 
               <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />}
              <span className="text-sm font-medium">{message.text}</span>
              <button onClick={() => setMessage(null)} className="ml-auto p-1 hover:bg-black/5 rounded">
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <div className={`bg-white shadow-sm overflow-hidden flex-1 flex flex-col border-t border-slate-200 ${isFullscreen ? 'rounded-none' : 'rounded-none sm:rounded-xl sm:border'}`}>
          <div className="overflow-auto flex-1 bg-slate-50/30">
            <table className="w-full border-collapse table-fixed">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-40 h-[38px]">
                  <th className="sticky left-0 z-50 bg-slate-200 p-2 text-left font-black text-slate-800 border-r border-slate-400 w-[160px] shadow-[4px_0_8px_-4px_rgba(0,0,0,0.2)]">
                    スタッフ
                  </th>
                  {daysInMonth.map(day => (
                    <th 
                      key={day.toISOString()} 
                      className={`p-1 text-center border-r border-slate-200 w-[45px] ${(isWeekend(day) || holidays[format(day, 'yyyy-MM-dd')]) ? 'bg-slate-100/50' : ''}`}
                    >
                      <div className={`text-[9px] uppercase font-bold ${(isWeekend(day) || holidays[format(day, 'yyyy-MM-dd')]) ? 'text-rose-500' : 'text-slate-400'}`}>
                        {getDayName(day)}
                      </div>
                      <div className={`text-xs font-bold ${(isWeekend(day) || holidays[format(day, 'yyyy-MM-dd')]) ? 'text-rose-600' : 'text-slate-700'}`}>
                        {format(day, 'd')}
                      </div>
                    </th>
                  ))}
                  <th className="p-2 text-center font-semibold text-slate-600 w-[140px]">
                    統計
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Daily Requirements Row */}
                <tr className="bg-indigo-50 border-b border-slate-200 sticky top-[38px] z-30 h-[30px]">
                  <td className="sticky left-0 z-50 bg-indigo-200 p-2 font-black text-indigo-950 border-r border-slate-400 text-[10px] shadow-[4px_0_8px_-4px_rgba(0,0,0,0.2)]">
                    必要人数
                  </td>
                  {daysInMonth.map(day => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    return (
                      <td key={day.toISOString()} className="p-0.5 border-r border-slate-200">
                        <input 
                          type="number"
                          min="0"
                          max={staffList.length}
                          value={dailyRequirements[dateStr] ?? (getDay(day) === 0 ? 0 : DEFAULT_DAILY_REQUIREMENT)}
                          onChange={(e) => updateRequirement(day, e.target.value)}
                          className="w-full text-center bg-transparent font-bold text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded text-xs"
                        />
                      </td>
                    );
                  })}
                  <td className="bg-indigo-50"></td>
                </tr>

                {/* Actual Count Row */}
                <tr className="bg-slate-100 border-b border-slate-300 sticky top-[68px] z-30 h-[30px]">
                  <td className="sticky left-0 z-50 bg-slate-300 p-2 font-black text-slate-900 border-r border-slate-400 text-[10px] shadow-[4px_0_8px_-4px_rgba(0,0,0,0.2)]">
                    現在の勤務
                  </td>
                  {daysInMonth.map(day => {
                    const count = getDailyCount(day);
                    const req = dailyRequirements[format(day, 'yyyy-MM-dd')] ?? (getDay(day) === 0 ? 0 : DEFAULT_DAILY_REQUIREMENT);
                    const isShort = count < req;
                    const isOver = count > req;
                    return (
                      <td 
                        key={day.toISOString()} 
                        className={`p-1 text-center border-r border-slate-200 text-xs font-bold ${
                          isShort ? 'text-rose-600 bg-rose-100 animate-pulse' : 
                          isOver ? 'text-amber-600 bg-amber-50' : 
                          'text-emerald-600 bg-emerald-50'
                        }`}
                      >
                        {count}
                      </td>
                    );
                  })}
                  <td className="bg-slate-50"></td>
                </tr>

                {/* Staff Rows */}
                {staffList.map((staff, idx) => {
                  const stats = getStaffStats(staff.id);
                  return (
                    <tr key={staff.id} className="border-b border-slate-200 hover:bg-indigo-50/20 transition-colors">
                      <td className="sticky left-0 z-10 bg-white p-1 font-medium text-slate-700 border-r border-slate-400 group-hover:bg-slate-50 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1">
                            <div className="w-4 h-4 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-[8px] font-bold text-slate-400">
                              {idx + 1}
                            </div>
                            <input 
                              value={staff.name}
                              onChange={(e) => {
                                const newName = e.target.value;
                                setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, name: newName } : s));
                              }}
                              className="bg-transparent focus:outline-none focus:bg-white px-0.5 rounded border border-transparent focus:border-slate-200 flex-1 min-w-0 text-[11px] font-bold"
                            />
                            <div className="flex items-center gap-0.5 shrink-0">
                              <span className="text-[8px] text-slate-400 font-bold">休:</span>
                              <input 
                                type="number"
                                min="0"
                                value={staff.targetOffCount}
                                onChange={(e) => {
                                  const count = parseInt(e.target.value) || 0;
                                  setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, targetOffCount: count } : s));
                                }}
                                className="w-6 text-[9px] bg-indigo-50 border border-indigo-100 rounded text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold text-indigo-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between px-0.5">
                            {[
                              { id: 'duty', label: '当', checked: staff.canDoDuty, count: staff.historicalDutyCount, setter: 'canDoDuty', countSetter: 'historicalDutyCount' },
                              { id: 'early700', label: '⑦', checked: staff.canDoEarly700, count: staff.historicalEarly700Count, setter: 'canDoEarly700', countSetter: 'historicalEarly700Count' },
                              { id: 'early745', label: '45', checked: staff.canDoEarly745, count: staff.historicalEarly745Count, setter: 'canDoEarly745', countSetter: 'historicalEarly745Count' },
                              { id: 'late', label: '遅', checked: staff.canDoLate, count: staff.historicalLateCount, setter: 'canDoLate', countSetter: 'historicalLateCount' },
                            ].map(item => (
                              <div key={item.id} className="flex flex-col items-center">
                                <input 
                                  type="checkbox"
                                  checked={item.checked}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, [item.setter]: checked } : s));
                                  }}
                                  className="w-2.5 h-2.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <div className="flex items-center gap-0.5">
                                  <span className="text-[7px] text-slate-500 font-bold">{item.label}</span>
                                  <input 
                                    type="number"
                                    min="0"
                                    value={item.count}
                                    onChange={(e) => {
                                      const count = parseInt(e.target.value) || 0;
                                      setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, [item.countSetter]: count } : s));
                                    }}
                                    className="w-5 text-[7px] bg-slate-50 border border-slate-100 rounded text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    {daysInMonth.map(day => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const shiftId = shiftData[staff.id]?.[dateStr];
                      const pattern = shiftPatterns.find(p => p.id === shiftId);
                      return (
                        <td 
                          key={day.toISOString()} 
                          className={`p-0 border-r border-slate-100 cursor-pointer transition-all ${isWeekend(day) ? 'bg-slate-50/30' : ''}`}
                          onClick={() => handleCellClick(staff.id, day)}
                        >
                          <div className="h-10 flex items-center justify-center relative group">
                            {pattern && (
                              <motion.div 
                                layoutId={`shift-${staff.id}-${dateStr}`}
                                className={`w-8 h-8 rounded-lg ${pattern.color} ${pattern.type === 'work' ? 'text-white' : (['paid-leave', 'request-off'].includes(pattern.id) ? 'text-rose-600' : 'text-slate-600')} flex items-center justify-center text-xs font-bold shadow-sm relative`}
                              >
                                {pattern.label}
                                {fixedCells[staff.id]?.[dateStr] && (
                                  <div className="absolute -top-1.5 -right-1.5 text-[10px] text-indigo-600 drop-shadow-sm">★</div>
                                )}
                              </motion.div>
                            )}
                            {!shiftId ? (
                              <div className="w-8 h-8 rounded-lg border border-dashed border-slate-200 group-hover:border-slate-300 transition-colors" />
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                    <td className="p-1 text-center text-[9px] text-slate-600 bg-slate-50/50">
                      {(() => {
                        const stats = getStaffStats(staff.id);
                        return (
                          <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
                            <div className="text-left whitespace-nowrap">休:<span className={`font-bold ${stats.off > staff.targetOffCount ? 'text-rose-600' : 'text-slate-700'}`}>{stats.off}</span>/{staff.targetOffCount}</div>
                            <div className="text-left">当:<span className="font-bold">{stats.duty}</span></div>
                            <div className="text-left">⑦:<span className="font-bold">{stats.early700}</span></div>
                            <div className="text-left">45:<span className="font-bold">{stats.early745}</span></div>
                            <div className="text-left">通:<span className="font-bold">{stats.normal}</span></div>
                            <div className="text-left">遅:<span className="font-bold">{stats.late}</span></div>
                            {stats.maternityLeave > 0 && (
                              <div className="text-left text-pink-600">産:<span className="font-bold">{stats.maternityLeave}</span></div>
                            )}
                            {stats.sickLongTerm > 0 && (
                              <div className="text-left text-orange-600">病:<span className="font-bold">{stats.sickLongTerm}</span></div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
