"use client";

import {
  Calculator,
  ChartScatter,
  GraduationCap,
  Home,
  Landmark,
  ListChecks,
  NotebookPen,
  Settings2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  HOME_ITEM,
  isWithin,
  NAV_SECTIONS,
  SETTINGS_ITEM,
  type NavItem,
} from "@/app/_components/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  "/": Home,
  "/valuacion": Calculator,
  "/sectores": ChartScatter,
  "/argentina": Landmark,
  "/cuenta": Wallet,
  "/plan": ListChecks,
  "/diario": NotebookPen,
  "/lecciones": GraduationCap,
  "/configuracion": Settings2,
};

/**
 * Sólo lo que existe: la ficha de la empresa vive en `/valuacion/[ticker]` y la
 * soja en `/argentina`, así que no quedan herramientas «planificadas» que
 * anunciar. El modo lo dice el header; la configuración va al pie, separada de
 * las páginas de trabajo.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileNavigation = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      {/* La marca y la configuración también navegan: todo vive en el landmark. */}
      <nav aria-label="Principal" className="flex min-h-0 flex-1 flex-col">
        {/*
         * `h-14` y sin padding vertical: el mismo alto que el header de la
         * columna, así que los dos bordes inferiores forman una sola línea. En el
         * drawer, `pr-12` deja lugar a su botón de cerrar.
         */}
        <SidebarHeader className="h-14 justify-center border-b border-sidebar-border py-0 max-md:pr-12">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="h-10 group-data-[collapsible=icon]:p-1!"
                tooltip="Portal Financiero"
                render={
                  <Link
                    href="/"
                    aria-label="Portal Financiero, inicio"
                    onClick={closeMobileNavigation}
                  />
                }
              >
                {/* El mismo sello se reconoce en la pestaña y en la sidebar colapsada. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- SVG local estático, sin optimización raster. */}
                <img
                  src="/brand/portal-mark.svg"
                  alt=""
                  width={28}
                  height={28}
                  className="size-7 shrink-0 group-data-[collapsible=icon]:size-6"
                />
                <span className="text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                  Portal Financiero
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="pb-0">
            <SidebarGroupContent>
              <SidebarMenu>
                <NavLink
                  item={HOME_ITEM}
                  pathname={pathname}
                  onNavigate={closeMobileNavigation}
                />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {NAV_SECTIONS.map((section) => (
            <SidebarGroup key={section.label} className="pb-0">
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => (
                    <NavLink
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      onNavigate={closeMobileNavigation}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <NavLink
              item={SETTINGS_ITEM}
              pathname={pathname}
              onNavigate={closeMobileNavigation}
            />
          </SidebarMenu>
        </SidebarFooter>
      </nav>
      <SidebarRail />
    </Sidebar>
  );
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = isWithin(pathname, item.href);
  const Icon = ICONS[item.href];

  return (
    <SidebarMenuItem>
      {/* 40 px en el drawer: holgado para el dedo sin que la lista parezca suelta. */}
      <SidebarMenuButton
        className="max-md:h-10"
        isActive={active}
        tooltip={item.label}
        render={
          <Link
            href={item.href as Route}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
          />
        }
      >
        {Icon === undefined ? null : <Icon />}
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
