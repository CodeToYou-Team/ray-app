"use client";

import {
  IconTrendingUp,
  IconTrendingDown,
  IconWallet,
  IconPackage,
} from "@tabler/icons-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { ExpensesPieChart } from "@/components/dashboard/expenses-pie-chart";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { AlertsBanner } from "@/components/dashboard/alerts-banner";
import { StaggerContainer, StaggerItem } from "@/components/motion";
import {
  getCurrentMonthIncome,
  getCurrentMonthExpenses,
  getPreviousMonthIncome,
  getPreviousMonthExpenses,
  getActiveProducts,
  getPercentChange,
  formatCurrency,
} from "@/lib/mock-data";

export default function DashboardPage() {
  const currentIncome = getCurrentMonthIncome();
  const currentExpenses = getCurrentMonthExpenses();
  const previousIncome = getPreviousMonthIncome();
  const previousExpenses = getPreviousMonthExpenses();
  const balance = currentIncome - currentExpenses;
  const previousBalance = previousIncome - previousExpenses;
  const activeProducts = getActiveProducts().length;

  const incomeChange = getPercentChange(currentIncome, previousIncome);
  const expenseChange = getPercentChange(currentExpenses, previousExpenses);
  const balanceChange = getPercentChange(balance, previousBalance);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Alerts */}
      <AlertsBanner />

      {/* KPIs */}
      <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StaggerItem>
          <KpiCard
            title="Ingresos del mes"
            value={formatCurrency(currentIncome)}
            change={incomeChange}
            changeLabel="vs mes anterior"
            icon={IconTrendingUp}
            trend={incomeChange >= 0 ? "up" : "down"}
            accentColor="success"
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            title="Gastos del mes"
            value={formatCurrency(currentExpenses)}
            change={expenseChange}
            changeLabel="vs mes anterior"
            icon={IconTrendingDown}
            trend={expenseChange <= 0 ? "up" : "down"}
            accentColor="destructive"
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            title="Balance neto"
            value={formatCurrency(balance)}
            change={balanceChange}
            changeLabel="vs mes anterior"
            icon={IconWallet}
            trend={balanceChange >= 0 ? "up" : "down"}
            accentColor="default"
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            title="Productos activos"
            value={activeProducts.toString()}
            change={0}
            changeLabel="sin cambios"
            icon={IconPackage}
            trend="neutral"
            accentColor="warning"
          />
        </StaggerItem>
      </StaggerContainer>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <RevenueChart />
        </div>
        <div className="lg:col-span-2">
          <ExpensesPieChart />
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <RecentTransactions />
        </div>
        <div className="lg:col-span-2 space-y-4">
          <QuickActions />
        </div>
      </div>
    </div>
  );
}
