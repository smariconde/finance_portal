import { expect, test } from "@playwright/test";

import { ROUTES } from "../support/runtime";

test.describe("lectura de velas", () => {
  test("los cuerpos se distinguen, el volumen queda centrado y el cursor llega a ambos extremos", async ({
    page,
  }) => {
    await page.goto(ROUTES.lessonSetup);
    const chart = page.getByRole("group", { name: /velas esquemáticas con/u });
    await expect(
      chart.locator("[data-candle-direction]").first(),
    ).toBeVisible();
    const geometry = await chart.evaluate((element) => {
      const candles = [
        ...element.querySelectorAll<SVGGElement>("[data-candle-direction]"),
      ];
      const bodies = candles.flatMap((candle) => [
        ...candle.querySelectorAll("rect"),
      ]);
      const volume =
        element.querySelectorAll<SVGGraphicsElement>("[data-volume-bar]");
      const centers = candles.map((candle) =>
        Number(candle.querySelector("line")?.getAttribute("x1")),
      );
      return {
        widths: bodies.map((body) => Number(body.getAttribute("width"))),
        fills: bodies.map((body) => body.getAttribute("fill")),
        alignment: volume.length
          ? [...volume].map((bar, index) =>
              Math.abs(
                bar.getBBox().x + bar.getBBox().width / 2 - centers[index]!,
              ),
            )
          : [],
      };
    });
    expect(geometry.widths.length).toBeGreaterThan(0);
    expect(Math.min(...geometry.widths)).toBeGreaterThanOrEqual(5);
    expect(new Set(geometry.fills)).toEqual(new Set(["currentColor"]));
    expect(geometry.alignment.length).toBeGreaterThan(0);
    expect(Math.max(...geometry.alignment)).toBeLessThan(1);

    await chart.focus();
    await page.keyboard.press("Home");
    const slider = page.getByRole("slider", { name: "Ventana de velas" });
    if (await slider.count()) {
      await expect(slider).toHaveValue("0");
      const maximum = await slider.getAttribute("max");
      await page.keyboard.press("End");
      await expect(slider).toHaveValue(maximum!);
      await expect(
        page.getByRole("button", { name: "Ver velas siguientes" }),
      ).toBeDisabled();
      await slider.focus();
      await page.keyboard.press("Home");
      await expect(slider).toHaveValue("0");
      await expect(
        page.getByRole("button", { name: "Ver velas anteriores" }),
      ).toBeDisabled();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
