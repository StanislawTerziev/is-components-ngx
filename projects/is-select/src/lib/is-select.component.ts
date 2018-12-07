import {
  Component,
  OnInit,
  EventEmitter,
  Input,
  Output,
  ElementRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Renderer2,
  ContentChild,
  TemplateRef,
  forwardRef
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Subscription } from 'rxjs';

import { SelectItem } from './select-item';
import { stripTags, escapeRegexp } from './select-pipes';
import { OptionsBehavior } from './select-interfaces';
import { IsSelectOptionDirective, IsSelectOptionSelectedDirective } from './is-select.directives';
import { ChildrenBehavior, GenericBehavior } from './behavior';

export const IS_SELECT_VALUE_ACCESSOR: any = {
  provide: NG_VALUE_ACCESSOR,
  useExisting: forwardRef(() => IsSelectComponent),
  multi: true
};

@Component({
  selector: 'is-select',
  templateUrl: './is-select.component.html',
  styleUrls: ['./is-select.component.scss'],
  providers: [IS_SELECT_VALUE_ACCESSOR],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IsSelectComponent implements OnInit, ControlValueAccessor {

  @Input() allowClear: boolean = false;
  @Input() placeholder: string = '';
  @Input() isSearch: boolean = true;

  @Input()
  set items(value: Array<any>) {
    if (!value) {
      this._items = this.itemObjects = [];
    } else {
      this._items = value.filter((item: any) => {
        if ((typeof item === 'string') || (typeof item === 'object' && item.text)) {
          return item;
        }
      });
      this.itemObjects = this._items.map((item: any) => new SelectItem(item));
    }
  }

  @Input()
  set disabled(value: boolean) {
    this.setDisabledState(value);
  }

  get disabled(): boolean {
    return this._disabled;
  }

  @Output() selected: EventEmitter<any> = new EventEmitter();
  @Output() removed: EventEmitter<any> = new EventEmitter();
  @Output() typed: EventEmitter<string> = new EventEmitter<string>();
  @Output() opened: EventEmitter<any> = new EventEmitter();
  @Output() changed: EventEmitter<any> = new EventEmitter();

  options: Array<SelectItem> = [];
  itemObjects: Array<SelectItem> = [];
  activeOption: SelectItem;

  get active(): SelectItem {
    return this._active;
  }

  set optionsOpened(value: boolean) {
    this._optionsOpened = value;
    this.opened.emit(value);
  }

  get optionsOpened(): boolean {
    return this._optionsOpened;
  }

  @ContentChild(IsSelectOptionDirective, { read: TemplateRef })
  templateOption: IsSelectOptionDirective;

  @ContentChild(IsSelectOptionSelectedDirective, { read: TemplateRef })
  templateOptionSelected: IsSelectOptionSelectedDirective;

  private inputMode: boolean = false;
  private _optionsOpened: boolean = false;
  private behavior: OptionsBehavior;
  inputValue: string = '';
  private _items: Array<any> = [];
  private _disabled: boolean = false;
  private _active: SelectItem = null;
  private _clickedOutsideListener = null;
  private onTouched: Function;
  private _changeSubscription: Subscription = null;

  constructor(public element: ElementRef, private renderer: Renderer2, private sanitizer: DomSanitizer, private changeDetector: ChangeDetectorRef) {

  }

  /**
   * Implemented as part of ControlValueAccessor.
   */
  writeValue(value: any): void {
    if (!value) {
      this._active = null;
    } else {
      this._active = new SelectItem(value);
      if (this.itemObjects && !this.itemObjects.find(o => o.id === this._active.id)) {
        this._active = null;
      }
    }
    this.changeDetector.markForCheck();
  }

  /**
   * Implemented as part of ControlValueAccessor.
   */
  registerOnChange(fn: (_: any) => {}): void {
    if (this._changeSubscription) {
      this._changeSubscription.unsubscribe();
    }
    this._changeSubscription = this.changed.subscribe(fn);
  }

  /**
   * Implemented as part of ControlValueAccessor.
   */
  setDisabledState(isDisabled: boolean): void {
    this._disabled = isDisabled;
    if (this._disabled === true) {
      this.hideOptions();
    }
    this.changeDetector.detectChanges();
  }

  registerOnTouched(fn: (_: any) => {}): void {
    this.onTouched = fn;
  }

  sanitize(html: string): any {
    // disable sanitizing as it breaks
    // selection event handlers in firefox
    return html;
  }

  inputEvent(e: any, isUpMode: boolean = false): void {
    // tab
    if (e.keyCode === 9) {
      return;
    }
    if (isUpMode && (e.keyCode === 37 || e.keyCode === 39 || e.keyCode === 38 ||
      e.keyCode === 40 || e.keyCode === 13)) {
      e.preventDefault();
      return;
    }
    // backspace
    if (!isUpMode && e.keyCode === 8) {
      const el: any = this.element.nativeElement
        .querySelector('div.ui-select-search > input');
      if (!el.value || el.value.length <= 0) {
        if (this.active) {
          this.remove();
        }
        e.preventDefault();
      }
    }
    // esc
    if (!isUpMode && e.keyCode === 27) {
      this.hideOptions();
      this.element.nativeElement.children[0].focus();
      e.preventDefault();
      return;
    }
    // del
    if (!isUpMode && e.keyCode === 46 && !this.optionsOpened) {
      if (this.active) {
        this.remove();
      }
      e.preventDefault();
    }
    // left
    if (!isUpMode && e.keyCode === 37 && this._items.length > 0) {
      this.behavior.first();
      e.preventDefault();
      return;
    }
    // right
    if (!isUpMode && e.keyCode === 39 && this._items.length > 0) {
      this.behavior.last();
      e.preventDefault();
      return;
    }
    // up
    if (!isUpMode && e.keyCode === 38) {
      this.behavior.prev();
      e.preventDefault();
      return;
    }
    // down
    if (!isUpMode && e.keyCode === 40) {
      this.behavior.next();
      e.preventDefault();
      return;
    }
    // enter
    if (!isUpMode && e.keyCode === 13) {
      this.selectActiveMatch();
      this.behavior.next();
      e.preventDefault();
      return;
    }
  }

  onSearchChange($event: any) {
    this.inputValue = $event;
    const filterValue = escapeRegexp(this.inputValue).trim();
    const parts: string[] = filterValue.split(' ').map((p: string) => p ? `(${p}).*` : '');
    this.behavior.filter(new RegExp(parts.join(''), 'ig'));
    this.typed.emit(this.inputValue);
  }

  ngOnInit(): any {
    this.behavior = (this.firstItemHasChildren) ?
      new ChildrenBehavior(this) : new GenericBehavior(this);
  }

  ngOnDestroy() {

  }

  remove(): void {
    if (this._disabled === true) {
      return;
    }
    const current = this._active;
    if (current) {
      this._active = null;
      this.changed.emit(null);
      this.removed.emit(current);
      this.changeDetector.markForCheck();
    }
  }

  private clickedOutside($event: MouseEvent): void {
    if (this.optionsOpened) {
      let element: HTMLElement = <HTMLElement>$event.target;
      let isThisEl = false;
      while (element.parentElement && !isThisEl) {
        isThisEl = this.element.nativeElement === element;
        element = element.parentElement;
      }
      if (!isThisEl) {
        this.hideOptions();
      }
    }
  }

  public get firstItemHasChildren(): boolean {
    return this.itemObjects[0] && this.itemObjects[0].hasChildren();
  }

  matchClick(e: MouseEvent): void {
    if (this._disabled === true) {
      return;
    }

    if (this.inputMode === true) {
      this.hideOptions();
      return;
    }
    this.inputMode = !this.inputMode;
    if (this.inputMode === true) {
      this.focusToInput();
      this.open();
    }
  }

  mainClick(event: any): void {
    if (this.inputMode === true || this._disabled === true) {
      return;
    }
    if (event.keyCode === 46) {
      event.preventDefault();
      this.inputEvent(event);
      return;
    }
    if (event.keyCode === 8) {
      event.preventDefault();
      this.inputEvent(event, true);
      return;
    }
    if (event.keyCode === 9 || event.keyCode === 13 ||
      event.keyCode === 27 || (event.keyCode >= 37 && event.keyCode <= 40)) {
      event.preventDefault();
      return;
    }
    this.inputMode = true;
    const value = String
      .fromCharCode(96 <= event.keyCode && event.keyCode <= 105 ? event.keyCode - 48 : event.keyCode)
      .toLowerCase();
    this.focusToInput(value);
    this.open();
    const target = event.target || event.srcElement;
    target.value = value;
    this.inputEvent(event);
  }

  selectActive(value: SelectItem): void {
    this.activeOption = value;
    this.changeDetector.markForCheck();
  }

  scrollToSelected(): void {
    const selectedElement = this.element.nativeElement.querySelector('div.ui-select-choices-row.selected');
    if (selectedElement === null) {
      return;
    }
    this.element.nativeElement.querySelector('ul.ui-select-choices').scrollTop = selectedElement.offsetTop - 40;
  }

  isActive(value: SelectItem): boolean {
    return this.activeOption.text === value.text;
  }

  removeClick(event: any): void {
    event.stopPropagation();
    this.remove();
  }

  focusToInput(value: string = ''): void {
    setTimeout(() => {
      const el = this.element.nativeElement.querySelector('div.ui-select-search > input');
      if (el) {
        el.focus();
        el.value = value;
      }
    }, 0);
  }

  private open(): void {
    this.options = this.itemObjects;
    // .filter((option: SelectItem) => (!this.active.find((o: SelectItem) => option.text === o.text)));

    if (this.options.length > 0) {
      this.behavior.first();
    }
    this.optionsOpened = true;
    this._clickedOutsideListener = this.renderer.listen('document', 'click', this.clickedOutside.bind(this));
    this.changeDetector.markForCheck();
  }

  hideOptions(): void {
    this.inputMode = false;
    this.optionsOpened = false;
    if (this._clickedOutsideListener) {
      this._clickedOutsideListener();
      this._clickedOutsideListener = null;
    }
    this.changeDetector.markForCheck();
  }

  private selectActiveMatch(): void {
    this.selectMatch(this.activeOption);
  }

  selectMatch(value: SelectItem, e: Event = void 0): void {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (this.options.length <= 0) {
      return;
    }
    this._active = value;
    this.changed.next(this.active.id);
    this.selected.emit(value);
    this.hideOptions();
    this.focusToInput(stripTags(value.text));
    this.element.nativeElement.querySelector('.ui-select-container').focus();
  }

}
