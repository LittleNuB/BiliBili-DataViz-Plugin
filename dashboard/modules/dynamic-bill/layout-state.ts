import type {
  DynamicBillItem,
  DynamicBillStatusFilter,
} from "../../../src/shared/types/dynamic-bill";

export interface DynamicBillLayoutState {
  visibleItems: DynamicBillItem[];
  selectedItem: DynamicBillItem | null;
  allColumnsEmpty: boolean;
}

export function resolveDynamicBillLayoutState(
  items: DynamicBillItem[],
  statusFilter: DynamicBillStatusFilter,
  selectedBillKey: string,
): DynamicBillLayoutState {
  const visibleItems = items.filter((item) =>
    matchesDynamicBillStatusFilter(item, statusFilter),
  );
  const selectedItem =
    visibleItems.find((item) => item.billKey === selectedBillKey) ??
    visibleItems[0] ??
    null;

  return {
    visibleItems,
    selectedItem,
    allColumnsEmpty: visibleItems.length === 0,
  };
}

export function chooseDynamicBillSelectedKey(
  current: string,
  items: DynamicBillItem[],
  statusFilter: DynamicBillStatusFilter,
): string {
  const visible = items.filter((item) =>
    matchesDynamicBillStatusFilter(item, statusFilter),
  );
  return current && visible.some((item) => item.billKey === current)
    ? current
    : visible[0]?.billKey ?? "";
}

export function matchesDynamicBillStatusFilter(
  item: DynamicBillItem,
  statusFilter: DynamicBillStatusFilter,
): boolean {
  if (statusFilter === "active") {
    return item.status === "unopened" || item.status === "opened";
  }
  return item.status === statusFilter;
}
