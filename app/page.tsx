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
  subMonths
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
const DEFAULT_DAILY_REQUIREMENT = 7;

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

interface Constraints {
  maxConsecutiveWork: number;
  dutyWeekendContinuous: boolean;
  earlyAfterDutyNormal: boolean;
  pairConstraint: {
    enabled: boolean;
    staffIds: string[];
  };
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
    pairConstraint: {
      enabled: false,
      staffIds: ['', '', ''],
    },
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
    { id: 'maternity-leave', name: '長期産休', label: '産', color: 'bg-pink-100', type: 'off' },
    { id: 'sick-leave', name: '病欠', label: '病', color: 'bg-orange-100', type: 'off' },
    { id: 'long-term-off', name: '長期休暇', label: '長', color: 'bg-emerald-100', type: 'off' },
  ]);
  const [longTermLeaves, setLongTermLeaves] = useState<{
    id: string;
    staffId: string;
    patternId: string;
    startDate: string;
    endDate: string;
  }[]>([]);
  const [newLongTermLeave, setNewLongTermLeave] = useState({
    staffId: '',
    patternId: 'maternity-leave',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
  });
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
          const isWeekendOrHoliday = dayOfWeek === 0 || dayOfWeek === 6 || isHoliday;
          
          const current = newShiftData[staff.id][dateStr];
          
          // Check for long term leaves first
          const longTermLeave = longTermLeaves.find(l => 
            l.staffId === staff.id && 
            dateStr >= l.startDate && 
            dateStr <= l.endDate
          );

          if (longTermLeave) {
            newShiftData[staff.id][dateStr] = longTermLeave.patternId;
          } else if (current !== 'request-off' && current !== 'maternity-leave' && current !== 'sick-leave' && current !== 'long-term-off' && current !== 'paid-leave') {
            newShiftData[staff.id][dateStr] = isWeekendOrHoliday ? 'off' : normalPattern;
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
            
            // Sort by total shifts to balance (historical + current month)
            available.sort((a, b) => {
              const countA = a.historicalDutyCount + Object.values(newShiftData[a.id]).filter(v => v === dutyPattern).length;
              const countB = b.historicalDutyCount + Object.values(newShiftData[b.id]).filter(v => v === dutyPattern).length;
              return countA - countB;
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
              return countA - countB;
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
        const isHoliday = !!holidays[dateStr];
        
        if (dayOfWeek === 0 || isHoliday) return;

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
            return countA - countB;
          });

          if (available.length > 0) {
            newShiftData[available[0].id][dateStr] = latePattern;
          }
        }
      });

      // 5. Adjust to meet daily requirements (Fill or Reduce)
      daysInMonth.forEach((day, idx) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const prevDateStr = idx > 0 ? format(daysInMonth[idx-1], 'yyyy-MM-dd') : null;
        const dayOfWeek = getDay(day);
        const dayOfMonth = day.getDate();
        const weekOfMonth = Math.ceil(dayOfMonth / 7);
        
        // Sundays are all off by default (except duty)
        const required = dailyRequirements[dateStr] ?? (dayOfWeek === 0 ? 0 : DEFAULT_DAILY_REQUIREMENT);
        
        let currentWorking = staffList.filter(s => {
          const p = shiftPatterns.find(pat => pat.id === newShiftData[s.id][dateStr]);
          return p?.type === 'work';
        });

        if (currentWorking.length < required) {
          // Need more people
          let available = staffList.filter(s => 
            newShiftData[s.id][dateStr] === 'off' && 
            newShiftData[s.id][dateStr] !== 'request-off' &&
            newShiftData[s.id][dateStr] !== 'paid-leave'
          );

          available.sort((a, b) => {
            const countA = Object.values(newShiftData[a.id]).filter(v => shiftPatterns.find(p => p.id === v)?.type === 'work').length;
            const countB = Object.values(newShiftData[b.id]).filter(v => shiftPatterns.find(p => p.id === v)?.type === 'work').length;
            return countA - countB;
          });

          for (let i = 0; i < Math.min(required - currentWorking.length, available.length); i++) {
            newShiftData[available[i].id][dateStr] = normalPattern;
          }
        } else if (currentWorking.length > required) {
          // Too many people - set some to 'off' ONLY if they haven't reached their target off count
          // Prioritize work over off as requested
          let candidates = currentWorking.filter(s => 
            newShiftData[s.id][dateStr] === normalPattern &&
            !fixedAssignments.some(f => 
              f.staffName === s.name && 
              f.patternId === normalPattern &&
              (f.dayOfWeek === undefined || f.dayOfWeek === dayOfWeek) &&
              (f.weekOfMonth === undefined || f.weekOfMonth === weekOfMonth)
            ) &&
            !(prevDateStr && newShiftData[s.id][prevDateStr] === dutyPattern)
          );

          // Sort by current off count (ascending) to give off days to those who have fewer
          candidates.sort((a, b) => {
            const offA = Object.values(newShiftData[a.id]).filter(v => v === 'off' || v === 'request-off' || v === 'paid-leave').length;
            const offB = Object.values(newShiftData[b.id]).filter(v => v === 'off' || v === 'request-off' || v === 'paid-leave').length;
            return offA - offB;
          });

          for (let i = 0; i < candidates.length; i++) {
            if (currentWorking.length <= required) break;
            
            const staff = candidates[i];
            const currentOffCount = Object.values(newShiftData[staff.id]).filter(v => v === 'off' || v === 'request-off' || v === 'paid-leave').length;
            
            // Only set to off if they are below their target off count
            if (currentOffCount < staff.targetOffCount) {
              newShiftData[staff.id][dateStr] = 'off';
              currentWorking = currentWorking.filter(s => s.id !== staff.id);
            }
          }
        }
      });

      // 6. Apply Pair Constraint (Ensure at least one of the pair works)
      if (constraints.pairConstraint.enabled && constraints.pairConstraint.staffIds.some(id => id !== '')) {
        const activeStaffIds = constraints.pairConstraint.staffIds.filter(id => id !== '');
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
            // Pick the one with fewer total shifts who is NOT on request-off or paid-leave
            const candidates = activeStaffIds
              .filter(id => newShiftData[id][dateStr] !== 'request-off' && newShiftData[id][dateStr] !== 'paid-leave')
              .sort((a, b) => {
                const countA = Object.values(newShiftData[a]).filter(v => v !== 'off' && v !== 'request-off' && v !== 'paid-leave').length;
                const countB = Object.values(newShiftData[b]).filter(v => v !== 'off' && v !== 'request-off' && v !== 'paid-leave').length;
                return countA - countB;
              });

            if (candidates.length > 0) {
              newShiftData[candidates[0]][dateStr] = normalPattern;
            }
          }
        });
      }

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
    const headers = ['スタッフ', ...daysInMonth.map(d => format(d, 'd')), '休み数', '当番数', '⑦数', '45数', '通常数', '遅番数', '産休数', '病欠数', '長期休暇数'];
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
      row.push(stats.sickLeave.toString());
      row.push(stats.longTermOff.toString());
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
            
            const date = new Date(dateStr);
            const dayOfWeek = getDay(date);
            const isHoliday = !!holidays[dateStr];
            const isWeekendOrHoliday = dayOfWeek === 0 || dayOfWeek === 6 || isHoliday;
            
            newShiftData[staff.id][dateStr] = isWeekendOrHoliday ? 'off' : 'normal';
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

  // Initialize shiftData with default 'normal' for weekdays if empty
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
            const dayOfWeek = getDay(day);
            const isHoliday = !!holidays[dateStr];
            const isWeekendOrHoliday = dayOfWeek === 0 || dayOfWeek === 6 || isHoliday;
            
            // Check for long-term leaves
            const activeLeave = longTermLeaves.find(leave => 
              leave.staffId === staff.id && 
              dateStr >= leave.startDate && 
              dateStr <= leave.endDate
            );

            if (activeLeave) {
              newShiftData[staff.id][dateStr] = activeLeave.patternId;
            } else if (staff.isMaternityLeave) {
              newShiftData[staff.id][dateStr] = 'maternity-leave';
            } else {
              newShiftData[staff.id][dateStr] = isWeekendOrHoliday ? 'off' : 'normal';
            }
            changed = true;
          }
        });
      });
      
      return changed ? newShiftData : prev;
    });
  }, [staffList, daysInMonth, holidays, longTermLeaves]);

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
      sickLeave: 0,
      longTermOff: 0
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
      if (shiftId === 'sick-leave') stats.sickLeave++;
      if (shiftId === 'long-term-off') stats.longTermOff++;
    });
    return stats;
  };

  return (
    <div className={`min-h-screen bg-slate-50 ${isFullscreen ? 'p-0' : 'p-0 sm:p-4 md:p-6 lg:p-8'}`}>
      <div className={`w-full ${isFullscreen ? 'space-y-0' : 'space-y-0 sm:space-y-6'}`}>
        
        {/* Header */}
        <header className={`flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 md:p-6 shadow-sm border-b border-slate-200 ${isFullscreen ? 'rounded-none' : 'rounded-none sm:rounded-2xl sm:border'}`}>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-600 rounded-xl text-white">
              <CalendarIcon size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">勤務表作成ツール</h1>
              <p className="text-sm text-slate-500 font-bold">A作成</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
            <button 
              onClick={handlePrevMonth}
              className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="px-4 font-semibold min-w-[120px] text-center">
              {format(currentDate, 'yyyy年 MM月', { locale: ja })}
            </span>
            <button 
              onClick={handleNextMonth}
              className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={toggleFullscreen}
              className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title={isFullscreen ? "縮小" : "全画面表示"}
            >
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
            <button 
              onClick={exportToCSV}
              className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="CSVダウンロード"
            >
              <Download size={20} />
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="条件設定"
            >
              <Settings size={20} />
            </button>
            <button 
              onClick={() => resetShifts(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              リセット
            </button>
            <button 
              onClick={generateShifts}
              disabled={isGenerating}
              className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-200"
            >
              {isGenerating ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Play size={18} fill="currentColor" />
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
                className="bg-white rounded-2xl p-6 w-full max-w-5xl shadow-2xl space-y-6"
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

                  <div className="pt-4 border-t border-slate-100 space-y-4">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <CalendarIcon size={16} className="text-indigo-600" />
                      長期休暇・産休・病欠の設定
                    </h3>
                    
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-end gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                          <div className="flex-1 min-w-[120px] space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold ml-1">スタッフ</label>
                            <select 
                              value={newLongTermLeave.staffId}
                              onChange={(e) => setNewLongTermLeave(prev => ({ ...prev, staffId: e.target.value }))}
                              className="w-full text-xs p-2 border border-slate-200 rounded bg-white"
                            >
                              <option value="">スタッフを選択</option>
                              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                          <div className="flex-1 min-w-[100px] space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold ml-1">理由</label>
                            <select 
                              value={newLongTermLeave.patternId}
                              onChange={(e) => setNewLongTermLeave(prev => ({ ...prev, patternId: e.target.value }))}
                              className="w-full text-xs p-2 border border-slate-200 rounded bg-white"
                            >
                              <option value="maternity-leave">産休</option>
                              <option value="sick-leave">病欠</option>
                              <option value="long-term-off">長期休暇</option>
                            </select>
                          </div>
                          <div className="flex-1 min-w-[130px] space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold ml-1">開始</label>
                            <input 
                              type="date"
                              value={newLongTermLeave.startDate}
                              onChange={(e) => setNewLongTermLeave(prev => ({ ...prev, startDate: e.target.value }))}
                              className="w-full text-xs p-1.5 border border-slate-200 rounded bg-white"
                            />
                          </div>
                          <div className="flex-1 min-w-[130px] space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold ml-1">終了</label>
                            <input 
                              type="date"
                              value={newLongTermLeave.endDate}
                              onChange={(e) => setNewLongTermLeave(prev => ({ ...prev, endDate: e.target.value }))}
                              className="w-full text-xs p-1.5 border border-slate-200 rounded bg-white"
                            />
                          </div>
                          <button 
                            onClick={() => {
                              if (!newLongTermLeave.staffId) {
                                setMessage({ text: 'スタッフを選択してください。', type: 'error' });
                                return;
                              }
                              const id = `ltl-${Date.now()}`;
                              setLongTermLeaves(prev => [...prev, { ...newLongTermLeave, id }]);
                              
                              // Automatically update shiftData for the current month if it overlaps
                              setShiftData(prev => {
                                const newData = { ...prev };
                                const staff = staffList.find(s => s.id === newLongTermLeave.staffId);
                                if (!staff) return prev;
                                if (!newData[staff.id]) newData[staff.id] = {};
                                
                                daysInMonth.forEach(day => {
                                  const dateStr = format(day, 'yyyy-MM-dd');
                                  if (dateStr >= newLongTermLeave.startDate && dateStr <= newLongTermLeave.endDate) {
                                    newData[staff.id][dateStr] = newLongTermLeave.patternId;
                                  }
                                });
                                return newData;
                              });
                              
                              setMessage({ text: '長期休暇を設定しました。', type: 'success' });
                            }}
                            className="px-4 py-2 text-xs font-bold bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors h-[34px]"
                          >
                            追加
                          </button>
                        </div>

                      <div className="max-h-[120px] overflow-y-auto space-y-2 border border-slate-100 rounded-xl p-1.5 bg-slate-50/30">
                        {longTermLeaves.length === 0 ? (
                          <div className="text-center py-4 text-slate-400 text-[10px] italic">
                            設定済みの長期休暇はありません
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-1.5">
                            {longTermLeaves.map((leave) => (
                              <div key={leave.id} className="flex items-center justify-between px-2 py-1 bg-white border border-slate-100 rounded shadow-sm">
                                <div className="flex items-center gap-1.5 overflow-hidden">
                                  <span className="font-bold text-slate-700 text-[10px] truncate max-w-[60px]">
                                    {staffList.find(s => s.id === leave.staffId)?.name}
                                  </span>
                                  <span className={`px-1 rounded-[2px] text-[9px] text-white flex-shrink-0 ${shiftPatterns.find(p => p.id === leave.patternId)?.color}`}>
                                    {shiftPatterns.find(p => p.id === leave.patternId)?.label}
                                  </span>
                                  <span className="text-[8px] text-slate-400 truncate">
                                    {leave.startDate.split('-').slice(1).join('/')}〜
                                  </span>
                                </div>
                                <button 
                                  onClick={() => {
                                    setLongTermLeaves(prev => prev.filter(l => l.id !== leave.id));
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
                        <button 
                          onClick={() => setConstraints(prev => ({ 
                            ...prev, 
                            pairConstraint: { ...prev.pairConstraint, enabled: !prev.pairConstraint.enabled } 
                          }))}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${constraints.pairConstraint.enabled ? 'bg-indigo-600' : 'bg-slate-200'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${constraints.pairConstraint.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                      
                      {constraints.pairConstraint.enabled && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          {[0, 1, 2].map(index => (
                            <select 
                              key={index}
                              value={constraints.pairConstraint.staffIds[index]}
                              onChange={(e) => setConstraints(prev => {
                                const newIds = [...prev.pairConstraint.staffIds];
                                newIds[index] = e.target.value;
                                return { 
                                  ...prev, 
                                  pairConstraint: { ...prev.pairConstraint, staffIds: newIds } 
                                };
                              })}
                              className="text-xs p-2 border border-slate-200 rounded-lg bg-white"
                            >
                              <option value="">スタッフ{index + 1}を選択</option>
                              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          ))}
                        </div>
                      )}
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
        <div className={`bg-white shadow-sm border-b border-slate-200 overflow-hidden ${isFullscreen ? 'rounded-none' : 'rounded-none sm:rounded-2xl sm:border'}`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="sticky left-0 z-20 bg-slate-50 p-2 text-left font-semibold text-slate-600 border-r border-slate-200 min-w-[240px]">
                    スタッフ
                  </th>
                  {daysInMonth.map(day => (
                    <th 
                      key={day.toISOString()} 
                      className={`p-2 text-center border-r border-slate-200 min-w-[45px] ${(isWeekend(day) || holidays[format(day, 'yyyy-MM-dd')]) ? 'bg-slate-100/50' : ''}`}
                    >
                      <div className={`text-[10px] uppercase font-bold ${(isWeekend(day) || holidays[format(day, 'yyyy-MM-dd')]) ? 'text-rose-500' : 'text-slate-400'}`}>
                        {getDayName(day)}
                      </div>
                      <div className={`text-sm font-bold ${(isWeekend(day) || holidays[format(day, 'yyyy-MM-dd')]) ? 'text-rose-600' : 'text-slate-700'}`}>
                        {format(day, 'd')}
                      </div>
                    </th>
                  ))}
                  <th className="p-4 text-center font-semibold text-slate-600 min-w-[120px]">
                    統計
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Daily Requirements Row */}
                <tr className="bg-indigo-50/30 border-b border-slate-200">
                  <td className="sticky left-0 z-10 bg-indigo-50 p-2 font-semibold text-indigo-900 border-r border-slate-200">
                    必要人数
                  </td>
                  {daysInMonth.map(day => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    return (
                      <td key={day.toISOString()} className="p-1 border-r border-slate-200">
                        <input 
                          type="number"
                          min="0"
                          max={staffList.length}
                          value={dailyRequirements[dateStr] ?? (getDay(day) === 0 ? 0 : DEFAULT_DAILY_REQUIREMENT)}
                          onChange={(e) => updateRequirement(day, e.target.value)}
                          className="w-full text-center bg-transparent font-bold text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                        />
                      </td>
                    );
                  })}
                  <td className="bg-indigo-50"></td>
                </tr>

                {/* Staff Rows */}
                {staffList.map((staff, idx) => {
                  const staffMemos = fixedAssignments
                    .filter(f => f.staffName === staff.name && f.memo)
                    .map(f => f.memo)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .join(', ');
                  const stats = getStaffStats(staff.id);
                  return (
                    <tr key={staff.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="sticky left-0 z-10 bg-white p-2 font-medium text-slate-700 border-r border-slate-200 group-hover:bg-slate-50">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                {idx + 1}
                              </div>
                              <input 
                                value={staff.name}
                                onChange={(e) => {
                                  const newName = e.target.value;
                                  setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, name: newName } : s));
                                }}
                                className="bg-transparent focus:outline-none focus:bg-white px-1 rounded border border-transparent focus:border-slate-200 w-32 font-bold"
                              />
                              <div className="flex items-center gap-1 ml-2 shrink-0">
                                <span className="text-[10px] text-slate-400 font-bold">休み:</span>
                                <input 
                                  type="number"
                                  min="0"
                                  value={staff.targetOffCount}
                                  onChange={(e) => {
                                    const count = parseInt(e.target.value) || 0;
                                    setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, targetOffCount: count } : s));
                                  }}
                                  className="w-10 text-xs bg-indigo-50 border border-indigo-200 rounded px-1 text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold text-indigo-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-4 pl-8">
                              {[
                                { id: 'duty', label: '当', checked: staff.canDoDuty, count: staff.historicalDutyCount, setter: 'canDoDuty', countSetter: 'historicalDutyCount' },
                                { id: 'early700', label: '⑦', checked: staff.canDoEarly700, count: staff.historicalEarly700Count, setter: 'canDoEarly700', countSetter: 'historicalEarly700Count' },
                                { id: 'early745', label: '45', checked: staff.canDoEarly745, count: staff.historicalEarly745Count, setter: 'canDoEarly745', countSetter: 'historicalEarly745Count' },
                                { id: 'late', label: '遅', checked: staff.canDoLate, count: staff.historicalLateCount, setter: 'canDoLate', countSetter: 'historicalLateCount' },
                              ].map(item => (
                                <div key={item.id} className="flex flex-col items-center gap-1">
                                  <input 
                                    type="checkbox"
                                    checked={item.checked}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, [item.setter]: checked } : s));
                                    }}
                                    className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-slate-500 font-bold">{item.label}</span>
                                    <input 
                                      type="number"
                                      min="0"
                                      value={item.count}
                                      onChange={(e) => {
                                        const count = parseInt(e.target.value) || 0;
                                        setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, [item.countSetter]: count } : s));
                                      }}
                                      className="w-10 text-xs bg-slate-50 border border-slate-200 rounded px-1 text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
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
                    <td className="p-2 text-center text-[10px] text-slate-600">
                      {(() => {
                        const stats = getStaffStats(staff.id);
                        return (
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                            <div className="text-left">休: <span className={`font-bold ${stats.off > staff.targetOffCount ? 'text-rose-600' : 'text-slate-700'}`}>{stats.off}</span> / {staff.targetOffCount}</div>
                            <div className="text-left">当: <span className="font-bold">{stats.duty}</span></div>
                            <div className="text-left">⑦: <span className="font-bold">{stats.early700}</span></div>
                            <div className="text-left">45: <span className="font-bold">{stats.early745}</span></div>
                            <div className="text-left">通: <span className="font-bold">{stats.normal}</span></div>
                            <div className="text-left">遅: <span className="font-bold">{stats.late}</span></div>
                            {stats.maternityLeave > 0 && (
                              <div className="text-left text-pink-600">産: <span className="font-bold">{stats.maternityLeave}</span></div>
                            )}
                            {stats.sickLeave > 0 && (
                              <div className="text-left text-orange-600">病: <span className="font-bold">{stats.sickLeave}</span></div>
                            )}
                            {stats.longTermOff > 0 && (
                              <div className="text-left text-emerald-600">長: <span className="font-bold">{stats.longTermOff}</span></div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}

                {/* Actual Count Row */}
                <tr className="bg-slate-50 font-bold">
                  <td className="sticky left-0 z-10 bg-slate-50 p-2 text-slate-600 border-r border-slate-200">
                    合計出勤
                  </td>
                  {daysInMonth.map(day => {
                    const count = getDailyCount(day);
                    const req = dailyRequirements[format(day, 'yyyy-MM-dd')] ?? DEFAULT_DAILY_REQUIREMENT;
                    const isShort = count < req;
                    const isOver = count > req;
                    return (
                      <td key={day.toISOString()} className={`p-2 text-center border-r border-slate-200 ${(isShort || isOver) ? 'text-rose-600 bg-rose-50' : 'text-indigo-600'}`}>
                        {count}
                      </td>
                    );
                  })}
                  <td className="bg-slate-50"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
