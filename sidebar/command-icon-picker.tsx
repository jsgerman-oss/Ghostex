import { IconChevronDown } from "@tabler/icons-react";
import { useEffect, useId, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_SIDEBAR_COMMAND_ICON,
  DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
  getSidebarCommandIconLabel,
  normalizeSidebarCommandIconColor,
  type SidebarCommandIcon,
} from "../shared/sidebar-command-icons";
import { SIDEBAR_COMMAND_ICON_OPTIONS, SidebarCommandIconGlyph } from "./sidebar-command-icon";

export type CommandIconPickerProps = {
  icon?: SidebarCommandIcon;
  iconColor: string;
  onIconChange: (icon: SidebarCommandIcon) => void;
  onIconColorChange: (iconColor: string) => void;
};

export function CommandIconPicker({
  icon,
  iconColor,
  onIconChange,
  onIconColorChange,
}: CommandIconPickerProps) {
  const [colorText, setColorText] = useState(iconColor);
  const [isOpen, setIsOpen] = useState(false);
  const [iconListElement, setIconListElement] = useState<HTMLDivElement | null>(null);
  const labelId = useId();
  const selectedIcon = icon ?? DEFAULT_SIDEBAR_COMMAND_ICON;

  useEffect(() => {
    setColorText(iconColor);
  }, [iconColor]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!iconListElement) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      const maxScrollTop = iconListElement.scrollHeight - iconListElement.clientHeight;
      const nextScrollTop = Math.max(
        0,
        Math.min(maxScrollTop, iconListElement.scrollTop + event.deltaY),
      );

      if (nextScrollTop !== iconListElement.scrollTop) {
        event.preventDefault();
        event.stopPropagation();
        iconListElement.scrollTop = nextScrollTop;
      }
    };

    iconListElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      iconListElement.removeEventListener("wheel", handleWheel);
    };
  }, [iconListElement, isOpen]);

  const commitColorText = () => {
    const normalizedColor = normalizeSidebarCommandIconColor(colorText);
    if (!normalizedColor) {
      setColorText(iconColor);
      return;
    }

    if (normalizedColor !== iconColor) {
      onIconColorChange(normalizedColor);
    }
    setColorText(normalizedColor);
  };

  return (
    <div className="command-icon-picker-fields">
      <div className="command-config-field command-icon-picker-field">
        <span className="command-config-label" id={labelId}>
          Icon
        </span>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <button
              aria-expanded={isOpen}
              aria-labelledby={labelId}
              className="group-title-input command-config-input command-icon-picker-trigger"
              type="button"
            >
              <span className="command-icon-picker-trigger-value">
                <span aria-hidden="true" className="command-button-icon-shell">
                  <SidebarCommandIconGlyph
                    className="command-button-leading-icon"
                    color={iconColor}
                    icon={selectedIcon}
                    size={16}
                  />
                </span>
                <span>{getSidebarCommandIconLabel(selectedIcon)}</span>
              </span>
              <IconChevronDown
                aria-hidden="true"
                className="command-icon-picker-trigger-chevron"
                size={16}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="command-icon-picker-menu"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <Command>
              {/*
               * CDXC:SidebarActions 2026-05-15-14:24:
               * The action icon dropdown needs a searchable shadcn Command
               * input at the top while every option keeps a left-side glyph.
               * Use Popover for open/close behavior instead of custom document
               * listeners so keyboard and outside-click handling stay with the
               * component primitive.
               *
               * CDXC:SidebarActions 2026-05-15-14:46:
               * The picker appears inside a modal settings dialog, so wheel
               * input on the portaled Popover can be consumed by dialog scroll
               * locking before the browser performs default list scrolling.
               * Attach a non-passive wheel listener to the Command list so long
               * icon sets remain browseable while the modal background stays
               * locked.
               */}
              <CommandInput
                aria-label="Search icons"
                className="command-icon-picker-search"
                placeholder="Search icons"
                spellCheck={false}
              />
              <CommandList
                className="command-icon-picker-options scroll-mask-y"
                ref={setIconListElement}
              >
                <CommandEmpty className="command-icon-picker-empty-state">
                  No matching icons
                </CommandEmpty>
                <CommandGroup>
                  {SIDEBAR_COMMAND_ICON_OPTIONS.map((option) => (
                    <CommandItem
                      className="command-icon-picker-option"
                      data-checked={selectedIcon === option.icon}
                      key={option.icon}
                      onSelect={() => {
                        onIconChange(option.icon);
                        if (!normalizeSidebarCommandIconColor(colorText)) {
                          onIconColorChange(DEFAULT_SIDEBAR_COMMAND_ICON_COLOR);
                          setColorText(DEFAULT_SIDEBAR_COMMAND_ICON_COLOR);
                        }
                        setIsOpen(false);
                      }}
                      value={option.label}
                    >
                      <span aria-hidden="true" className="command-button-icon-shell">
                        <SidebarCommandIconGlyph
                          className="command-button-leading-icon"
                          color={
                            selectedIcon === option.icon
                              ? iconColor
                              : DEFAULT_SIDEBAR_COMMAND_ICON_COLOR
                          }
                          icon={option.icon}
                          size={16}
                        />
                      </span>
                      <span className="command-icon-picker-option-copy">{option.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <label className="command-config-field">
        <span className="command-config-label">Icon Color</span>
        <div className="command-icon-color-row">
          <input
            aria-label="Icon color"
            className="command-icon-color-swatch"
            onChange={(event) => {
              onIconColorChange(event.currentTarget.value);
              setColorText(event.currentTarget.value);
            }}
            type="color"
            value={iconColor}
          />
          <input
            className="group-title-input command-config-input command-icon-color-text"
            inputMode="text"
            onBlur={commitColorText}
            onChange={(event) => setColorText(event.currentTarget.value)}
            placeholder={DEFAULT_SIDEBAR_COMMAND_ICON_COLOR}
            spellCheck={false}
            value={colorText}
          />
        </div>
      </label>
    </div>
  );
}
