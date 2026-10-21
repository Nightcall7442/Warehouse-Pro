/** «2026-10-21» → «21.10.2026»: день заказа — строка, и через Date его не гоняем (пояс сдвинул бы день). */
export const dayText = (d: string | null | undefined): string => (d ? d.split("-").reverse().join(".") : "—");
