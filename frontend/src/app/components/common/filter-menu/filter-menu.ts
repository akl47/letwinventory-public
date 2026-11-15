import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

export interface FilterOption {
  id: number | string;
  label: string;
  colorHex?: string;
}

export type FilterSection<T> =
  | {
      type: 'toggle';
      key: string;
      label: string;
      default?: boolean;
      predicate?: (row: T, value: boolean) => boolean;
    }
  | {
      type: 'multiSelect';
      key: string;
      label: string;
      options: FilterOption[];
      /**
       * Returns the row's value(s) compared against the selected option ids.
       * Returning an array (e.g. for M:N relationships) matches if any element
       * is in the selected set.
       */
      accessor: (row: T) => number | string | Array<number | string> | null | undefined;
    };

/**
 * The Filter button and its drop-down: one group per section — a multi-select
 * group (an "All" checkbox with its options indented beneath it) or a single
 * toggle. Stateless: the host owns the values and applies them; this component
 * only reports what the user changed.
 */
@Component({
  selector: 'app-filter-menu',
  standalone: true,
  imports: [MatButtonModule, MatCheckboxModule, MatDividerModule, MatIconModule, MatMenuModule],
  templateUrl: './filter-menu.html',
  styleUrl: './filter-menu.css',
})
export class FilterMenu<T = unknown> {
  @Input({ required: true }) sections!: FilterSection<T>[];
  /** Current value per section key: a boolean for a toggle, a Set of option ids for a multi-select. */
  @Input() values: Record<string, unknown> = {};
  /** Number of filters that differ from their default — shown as a badge on the button. */
  @Input() activeCount = 0;
  @Output() valueChange = new EventEmitter<{ key: string; value: unknown }>();

  isToggleSection(s: FilterSection<T>): s is FilterSection<T> & { type: 'toggle' } {
    return s.type === 'toggle';
  }

  isMultiSelectSection(s: FilterSection<T>): s is FilterSection<T> & { type: 'multiSelect' } {
    return s.type === 'multiSelect';
  }

  private selection(key: string): Set<number | string> {
    return (this.values[key] as Set<number | string> | undefined) ?? new Set();
  }

  isSelected(key: string, optionId: number | string): boolean {
    return this.selection(key).has(optionId);
  }

  isAllSelected(section: FilterSection<T> & { type: 'multiSelect' }): boolean {
    return section.options.length > 0 && this.selection(section.key).size === section.options.length;
  }

  isSomeSelected(section: FilterSection<T> & { type: 'multiSelect' }): boolean {
    const size = this.selection(section.key).size;
    return size > 0 && size < section.options.length;
  }

  toggleOption(key: string, optionId: number | string): void {
    const next = new Set(this.selection(key));
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    this.valueChange.emit({ key, value: next });
  }

  toggleAll(section: FilterSection<T> & { type: 'multiSelect' }): void {
    const value = this.isAllSelected(section) ? new Set<number | string>() : new Set(section.options.map(o => o.id));
    this.valueChange.emit({ key: section.key, value });
  }

  setToggle(key: string, value: boolean): void {
    this.valueChange.emit({ key, value });
  }
}
