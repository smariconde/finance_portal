"use client";

import {
  BarChart3,
  Building2,
  Calculator,
  Database,
  Home,
  Landmark,
  Settings2,
  Wheat,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import type { AppMode } from "@/modules/configuration/domain/config-health";

const activeItems = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/configuracion", label: "Configuración", icon: Settings2 },
] as const;

const plannedItems = [
  { label: "Empresas", icon: Building2 },
  { label: "Matrices", icon: BarChart3 },
  { label: "Valuación", icon: Calculator },
  { label: "Argentina", icon: Landmark },
  { label: "Agro", icon: Wheat },
] as const;

type AppSidebarProps = {
  mode: AppMode;
};

export function AppSidebar({ mode }: AppSidebarProps) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileNavigation = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Portal Financiero"
              render={<Link href="/" aria-label="Portal Financiero, inicio" />}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-bold tracking-tight text-sidebar-primary-foreground">
                PF
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">
                  Portal Financiero
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  Workspace personal
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {activeItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    className="max-md:h-11"
                    isActive={
                      item.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.href)
                    }
                    tooltip={item.label}
                    render={
                      <Link
                        href={item.href}
                        aria-current={
                          (
                            item.href === "/"
                              ? pathname === "/"
                              : pathname.startsWith(item.href)
                          )
                            ? "page"
                            : undefined
                        }
                        onClick={closeMobileNavigation}
                      />
                    }
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Herramientas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {plannedItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    className="max-md:h-11"
                    disabled
                    tooltip={`${item.label}: planificado`}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>Plan</SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex h-11 items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2">
              <Database className="size-4 shrink-0" aria-hidden="true" />
              <span className="capitalize group-data-[collapsible=icon]:hidden">
                Modo {mode}
              </span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
