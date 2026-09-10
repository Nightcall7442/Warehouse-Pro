import { memo } from "react";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { Trophy, Flame, Target, Award, TrendingUp } from "lucide-react";
import { F } from "@/components/users/types";

interface LeaderboardEntry {
  rank: number;
  agentId: number;
  agentName: string;
  orderCount: number;
  revenue: number;
  visitCount: number;
}

interface Achievement {
  id: string;
  title: string;
  titleUz?: string;
  icon: string;
  unlocked: boolean;
}

interface GamificationData {
  leaderboard: LeaderboardEntry[];
  myStats: {
    weeklyOrders: number;
    weeklyRevenue: number;
    monthlyOrders: number;
    streak: number;
  };
  achievements: Achievement[];
  topAgent?: { name: string; revenue: number } | null;
}

/**
 * Цвет места — из палитры, а не числом.
 *
 * Здесь стояли «#9ca3af» и «#cd7f32» — серебро и бронза, вписанные числом. На
 * тёмной теме они остаются прежними, потому что число темы не знает: серое
 * пятно и рыжее пятно на угольном холсте. Ровно тот признак, по которому
 * владелец узнаёт «дёшево»: цвет, записанный числом, в этом приложении не
 * встречается больше нигде.
 *
 * Замена не выдумана: бронза в палитре уже есть — это `--kpi-orange`
 * (#c07040), а серебро в тёмном интерфейсе честнее всего читается нейтральным
 * текстовым тоном, а не выдуманным серым.
 */
const RANK_COLORS = ["var(--kpi-amber)", "var(--color-text-secondary)", "var(--kpi-orange)"];

/**
 * Как я на фоне остальных.
 *
 * ── Зачем это подключено ────────────────────────────────────────────────────
 *
 * Карточка была написана целиком и не показывалась нигде, а ручка под ней
 * (agent.gamification) не вызывалась ниоткуда: серия рабочих дней, достижения,
 * недельный список и лучший агент месяца считались на сервере в никуда.
 *
 * Вопрос, на который она отвечает, не отвечает ни один живой экран. Свой балл
 * и свою выручку агент видит рядом, но «много это или мало» из них не следует:
 * 4 000 000 за неделю — это первое место в одной организации и последнее в
 * другой. Список рядом стоящих отвечает на это одним взглядом.
 */
export const GamificationCard = memo(function GamificationCard({ data }: { data: GamificationData }) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  return (
    <div className="neo-card" style={{ padding: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        {/*
          Шрифт — из палитры, а не литералом: 'DM Sans' здесь стоял именем, и
          в наборе он один такой на весь проект. Заголовок карточки, набранный
          не тем шрифтом, читается как кусок чужого продукта.
        */}
        <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
          <Trophy size={16} style={{ color: "var(--color-warning-text)" }} />
          {t("Достижения", "Yutuqlar")}
        </h2>
        {/*
          Здесь стояла кнопка «Все →» на /agent. Карточка живёт как раз на
          экране показателей агента — кнопка вела туда, где человек уже стоит.
        */}
      </div>

      {/* My Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "16px" }}>
        <div className="neo-card-sm" style={{ padding: "12px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginBottom: "4px" }}>
            <Flame size={14} style={{ color: "var(--color-danger-text)" }} />
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("Серия", "Seriya")}
            </span>
          </div>
          <p style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
            {data.myStats.streak}
          </p>
          <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
            {t("дн.", "kun")}
          </p>
        </div>

        <div className="neo-card-sm" style={{ padding: "12px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginBottom: "4px" }}>
            <Target size={14} style={{ color: "var(--color-primary-text)" }} />
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("Заказы", "Buyurtmalar")}
            </span>
          </div>
          <p style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
            {data.myStats.weeklyOrders}
          </p>
          <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
            {t("за неделю", "haftada")}
          </p>
        </div>

        <div className="neo-card-sm" style={{ padding: "12px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginBottom: "4px" }}>
            <TrendingUp size={14} style={{ color: "var(--color-success-text)" }} />
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("Выручка", "Tushum")}
            </span>
          </div>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
            {fmt(data.myStats.weeklyRevenue, true)}
          </p>
          <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
            {t("за неделю", "haftada")}
          </p>
        </div>
      </div>

      {/* Achievements */}
      {data.achievements.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
            {t("Разблокированные", "Ochildi")}
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {data.achievements.map(a => (
              <div key={a.id} style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px",
                /*
                  Вдавленная плашка, а не крашеная. Здесь стоял литерал
                  rgba(232,168,48,…) — жёлтый и в тёмной теме, и у арендатора
                  с другим фирменным цветом; потом он стал янтарной заливкой и
                  превратился на тёмном в бурое пятно. Цвет несёт подпись,
                  фон — глубину.
                */
                borderRadius: "8px", background: "var(--color-surface-light)",
                boxShadow: "var(--shadow-pressed)",
              }}>
                <span style={{ fontSize: "14px" }}>{a.icon}</span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-warning-text)" }}>
                  {lang === "uz" && a.titleUz ? a.titleUz : a.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {data.leaderboard.length > 0 && (
        <div>
          <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
            {t("Топ агентов за неделю", "Haftalik top agentlar")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {data.leaderboard.slice(0, 5).map((entry, i) => (
              /*
                Строка — приподнятая полоса, а не крашеная.

                Тройку призёров подсвечивала заливка цветом места: на светлой
                теме бледный оттенок, на тёмной — бурое пятно во всю строку. В
                этом языке оформления разницу держит ГЛУБИНА, а не краска:
                поверхность вдавлена, объекты на ней приподняты. Поэтому у всех
                строк одна поверхность, а место называет значок слева.
              */
              <div key={entry.agentId} className="neo-card-sm" style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "8px 12px", borderRadius: "12px",
              }}>
                {/*
                  Место — числом у всех, включая тройку. Медали стояли
                  картинками (🥇🥈🥉), и рядом с четвёртым местом, набранным
                  цифрой, это два разных языка в одном столбце. Цвет значка
                  говорит про место ровно то же, что говорила медаль.
                */}
                <div style={{
                  width: "24px", height: "24px", borderRadius: "8px", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700,
                  flexShrink: 0,
                  background: "var(--color-surface-light)",
                  color: i < 3 ? RANK_COLORS[i] : "var(--color-text-tertiary)",
                  boxShadow: "var(--shadow-pressed)",
                }}>
                  {entry.rank}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.agentName}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-primary-text)", margin: 0 }}>
                    {entry.orderCount}
                  </p>
                  <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: 0 }}>
                    {t("заказов", "buyurtma")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Agent of Month */}
      {data.topAgent && (
        /*
          Лучший месяца — тоже полосой, а не заливкой. Цвет здесь несёт значок,
          а не фон: на тёмной теме тот же янтарь во всю ширину превращался в
          бурое поле.
        */
        <div className="neo-card-sm" style={{
          marginTop: "12px", padding: "12px", borderRadius: "12px",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <Award size={18} style={{ color: "var(--kpi-amber)" }} />
          <div>
            <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: 0 }}>
              {t("Лучший агент месяца", "Oyning eng yaxshi agenti")}
            </p>
            <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", margin: "2px 0 0" }}>
              {data.topAgent.name} — {fmt(data.topAgent.revenue, true)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
