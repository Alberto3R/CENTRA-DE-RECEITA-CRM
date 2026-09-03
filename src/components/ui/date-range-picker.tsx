"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Seletor de intervalo de datas em calendário.
 *
 * Escrito à mão sobre date-fns (que o projeto já usa) em vez de puxar
 * react-day-picker: são dois meses de grade, clique inicia o intervalo e
 * o segundo clique fecha — não vale uma dependência nova.
 *
 * O valor é sempre normalizado para o início do dia; quem filtra decide
 * o fim (ver `dentroDoIntervalo`).
 */

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Texto do botão quando não há intervalo escolhido. */
  placeholder?: string;
  className?: string;
}

/** Rótulo curto do intervalo, para o botão. */
export function rotuloDoIntervalo(
  { from, to }: DateRange,
  placeholder = "Escolher datas",
): string {
  if (!from && !to) return placeholder;
  const f = (d: Date) => format(d, "dd/MM/yy", { locale: ptBR });
  if (from && to) {
    return isSameDay(from, to) ? f(from) : `${f(from)} – ${f(to)}`;
  }
  return from ? `A partir de ${f(from)}` : `Até ${f(to as Date)}`;
}

/**
 * True quando `data` cai dentro do intervalo (bordas inclusivas, dia
 * inteiro). Um lado nulo deixa aquele lado aberto.
 */
export function dentroDoIntervalo(data: Date, { from, to }: DateRange): boolean {
  const dia = startOfDay(data).getTime();
  if (from && dia < startOfDay(from).getTime()) return false;
  if (to && dia > startOfDay(to).getTime()) return false;
  return true;
}

function MesDaGrade({
  mes,
  range,
  hover,
  onHover,
  onPick,
}: {
  mes: Date;
  range: DateRange;
  hover: Date | null;
  onHover: (d: Date | null) => void;
  onPick: (d: Date) => void;
}) {
  const dias = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(mes), { weekStartsOn: 0 }),
        end: endOfWeek(endOfMonth(mes), { weekStartsOn: 0 }),
      }),
    [mes],
  );

  // Prévia do intervalo enquanto só a primeira ponta foi escolhida.
  const fim = range.to ?? (range.from && hover ? hover : null);
  const inicio = range.from;

  return (
    <div className="w-[15.5rem]">
      <p className="mb-1.5 text-center text-xs font-medium text-popover-foreground capitalize">
        {format(mes, "MMMM yyyy", { locale: ptBR })}
      </p>
      <div className="grid grid-cols-7 gap-y-0.5">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <span
            key={`${d}-${i}`}
            className="py-1 text-center text-[10px] font-medium text-muted-foreground"
          >
            {d}
          </span>
        ))}
        {dias.map((dia) => {
          const foraDoMes = !isSameMonth(dia, mes);
          const ehInicio = inicio && isSameDay(dia, inicio);
          const ehFim = fim && isSameDay(dia, fim);
          const noMeio =
            inicio &&
            fim &&
            isAfter(dia, inicio) &&
            isBefore(dia, fim) &&
            !ehInicio &&
            !ehFim;
          const selecionado = ehInicio || ehFim;

          return (
            <button
              key={dia.toISOString()}
              type="button"
              onClick={() => onPick(dia)}
              onMouseEnter={() => onHover(dia)}
              className={cn(
                "h-7 rounded-md text-xs transition-colors",
                foraDoMes
                  ? "text-muted-foreground/40"
                  : "text-popover-foreground",
                noMeio && "bg-primary/15",
                selecionado &&
                  "bg-primary font-semibold text-primary-foreground",
                !selecionado && !noMeio && "hover:bg-muted",
              )}
            >
              {format(dia, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Escolher datas",
  className,
}: DateRangePickerProps) {
  const [aberto, setAberto] = useState(false);
  const [mesBase, setMesBase] = useState<Date>(
    () => startOfMonth(value.from ?? new Date()),
  );
  const [hover, setHover] = useState<Date | null>(null);

  function handlePick(dia: Date) {
    const d = startOfDay(dia);
    // Sem início, ou intervalo já fechado → começa um novo.
    if (!value.from || (value.from && value.to)) {
      onChange({ from: d, to: null });
      return;
    }
    // Segundo clique antes do primeiro → inverte, em vez de recusar.
    if (isBefore(d, value.from)) {
      onChange({ from: d, to: value.from });
    } else {
      onChange({ from: value.from, to: d });
    }
    setHover(null);
    setAberto(false);
  }

  const temValor = !!(value.from || value.to);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "h-9 justify-start border-border bg-card px-2.5 text-sm font-normal",
              temValor ? "text-foreground" : "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <CalendarDays className="size-4" />
        {rotuloDoIntervalo(value, placeholder)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => setMesBase((m) => subMonths(m, 1))}
            aria-label="Mês anterior"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setMesBase((m) => addMonths(m, 1))}
            aria-label="Próximo mês"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div
          className="flex flex-col gap-4 sm:flex-row"
          onMouseLeave={() => setHover(null)}
        >
          <MesDaGrade
            mes={mesBase}
            range={value}
            hover={hover}
            onHover={setHover}
            onPick={handlePick}
          />
          <MesDaGrade
            mes={addMonths(mesBase, 1)}
            range={value}
            hover={hover}
            onHover={setHover}
            onPick={handlePick}
          />
        </div>

        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-[11px] text-muted-foreground">
            {value.from && !value.to
              ? "Escolha a data final"
              : rotuloDoIntervalo(value, "Nenhum período escolhido")}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange({ from: null, to: null });
              setHover(null);
            }}
            className="text-xs text-primary hover:underline"
          >
            Limpar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
