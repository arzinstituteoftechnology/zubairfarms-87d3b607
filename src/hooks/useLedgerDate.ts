import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";

const LEDGER_DATE_KEY = "meatflow-ledger-date";
const LEDGER_DATE_EVENT = "meatflow-ledger-date-change";

export const getToday = () => format(new Date(), "yyyy-MM-dd");

const normalizeDate = (value?: string | null) => value || getToday();

export const useLedgerDate = () => {
  const [selectedDate, setSelectedDateState] = useState(() => {
    if (typeof window === "undefined") return getToday();
    return normalizeDate(window.localStorage.getItem(LEDGER_DATE_KEY));
  });

  const setSelectedDate = useCallback((value?: string | null) => {
    const next = normalizeDate(value);
    setSelectedDateState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LEDGER_DATE_KEY, next);
      window.dispatchEvent(new CustomEvent(LEDGER_DATE_EVENT, { detail: next }));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncDate = (value?: string | null) => setSelectedDateState(normalizeDate(value));
    const onStorage = (event: StorageEvent) => {
      if (event.key === LEDGER_DATE_KEY) syncDate(event.newValue);
    };
    const onLedgerDateChange = (event: Event) => syncDate((event as CustomEvent<string>).detail);

    window.addEventListener("storage", onStorage);
    window.addEventListener(LEDGER_DATE_EVENT, onLedgerDateChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LEDGER_DATE_EVENT, onLedgerDateChange);
    };
  }, []);

  const today = getToday();
  return { selectedDate, setSelectedDate, today, isToday: selectedDate === today };
};