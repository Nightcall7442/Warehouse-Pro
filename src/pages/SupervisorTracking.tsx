import { trpc } from "@/providers/trpc";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang, useTranslate } from "@/i18n";
import { cssVar } from "@/lib/css-var";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";
import { Radio, RefreshCw, MapPin, Store, Maximize2, Info } from "lucide-react";
import {
  TIER_COLOR, TIER_LABEL, TIER_ORDER, shopPinSvg,
  PIN_SIZE, PIN_ANCHOR, PIN_ANIMATION_LIMIT, type ShopTier,
  PIN_FOOTPRINT,
} from "@/lib/shop-tier";
import { buildRoster, timeAgo, STATE_TINT, type TrackedState } from "@/components/tracking/agent-roster";
import { visiblePins, boundsOf } from "@/components/tracking/map-declutter";
import { AgentRail } from "@/components/tracking/AgentRail";
import { AgentDayPanel } from "@/components/tracking/AgentDayPanel";
import { buildAgentDays } from "@/components/tracking/agent-day";
import { drawTrail } from "@/lib/tracking-motion";
import { pathLengthKm } from "@contracts/geo";

/**
 * ЧТО ЭТО ЗА ЭКРАН
 *
 * Рабочее место супервайзера: где мои люди сейчас, кто на связи, кого куда
 * послать, какие точки рядом. Всё это — вопросы про КАРТУ, поэтому карта тут
 * не иллюстрация справа, а сама страница; список агентов лежит на ней
 * панелью, а не отбирает треть ширины.
 *
 * Прежняя раскладка отвечала на другие вопросы. Четверть экрана занимали три
 * плитки «ОНЛАЙН 0 · НЕ В СЕТИ 0 · ВСЕГО 0»: три числа, из которых два —
 * разность третьего, и ни одно не говорит, что делать. Треть ширины уходила
 * под колонку, в которой почти всегда пусто, потому что геолокацию агент
 * включает сам и половина смены проходит без неё. Молчание тут не сбой, а
 * обычный день, и экран обязан объяснять именно его.
 */

/**
 * Ключ Яндекс.Карт.
 *
 * Значение в коде — запасное, на случай сборки без переменной: локально, из
 * форка, в тесте. Секретом оно не является — ключ карт уходит в браузер
 * вместе с бандлом при любом способе хранения, и ограничен на стороне
 * Яндекса списком доменов, а не тайной.
 *
 * Переменную читать всё равно нужно: у разных сред разные списки доменов, и
 * ключ иногда меняют. До сих пор эта строка была бесполезной — Dockerfile не
 * передавал VITE_YANDEX_MAPS_API_KEY в сборку, Vite её не видел, и в
 * продакшн всегда уезжало запасное значение.
 */
const YANDEX_MAPS_API_KEY = import.meta.env.VITE_YANDEX_MAPS_API_KEY || "dd072e98-24e7-4b2e-b328-2989bd981fa5";

/**
 * Карта во всю доступную высоту.
 *
 * Было жёстко 480 пикселей при любом экране: на ноутбуке под картой
 * оставалось пустое поле, а на большом мониторе — половина экрана впустую.
 * Нижняя граница нужна, чтобы карта не выродилась в полоску на телефоне.
 */
const MAP_HEIGHT = "clamp(420px, calc(100vh - 296px), 820px)";

/**
 * Куда смотреть, пока не пришло ни одной точки.
 *
 * Ташкент — не выбор дизайнера, а место, где стоят все нынешние арендаторы.
 * Как только приходят координаты — агентов или, если их нет, магазинов, —
 * вид подгоняется под них, и это значение больше ни на что не влияет.
 */
const DEFAULT_CENTER = [41.2995, 69.2401];

/**
 * Подписи в подсказках карты собираются строкой и уходят в innerHTML самой
 * карты. Имя магазина и имя сотрудника вводит человек, и кавычка в названии
 * («Магазин "Меркурий"») ломала бы разметку подсказки, а угловая скобка — не
 * только её.
 */
function esc(value: string): string {
  return value.replace(/[&<>"]/g, c =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;");
}

export default function SupervisorTracking() {
  const { lang } = useLang();
  const t = useTranslate();
  const { fmt } = useCurrency();

  const locationsQuery = trpc.agent.getLocations.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: locations, isLoading, refetch, dataUpdatedAt } = locationsQuery;
  /**
   * Отказ без данных и отказ поверх данных — разные вещи, и путать их нельзя.
   *
   * `failed` — показывать нечего, и это именно сбой связи, а не молчание
   * агентов: экран обязан сказать это словами, иначе отказ выглядит ровно как
   * «никто не делится», и человек идёт трясти агентов вместо связиста.
   *
   * `stalled` — данные с прошлого опроса на экране остались, а очередной не
   * прошёл. Стирать их нельзя (карта нужна), но и молчать нельзя: точки на
   * ней стареют, а «прямой эфир» продолжал бы мигать как ни в чём не бывало.
   */
  const failed  = locationsQuery.isLoadingError;
  const stalled = locationsQuery.isError && !!locations;

  /**
   * Справочник агентов — вторым запросом, и это главная прибавка экрана.
   *
   * getLocations отдаёт только тех, кто прислал точку. Агент с выключенной
   * геолокацией в ответе отсутствует, то есть на прежнем экране его не было
   * вовсе — ни строки, ни объяснения. Справочник даёт вторую половину
   * ответа: кто ещё есть и от кого сигнала нет.
   *
   * listAgents открыт супервайзеру (reportsQuery) и отдаёт только id и имя —
   * лишнего в ответе нет, кэш на пять минут, состав агентов за смену не
   * меняется.
   */
  const rosterQuery = trpc.agent.listAgents.useQuery(undefined, { staleTime: 5 * 60_000 });

  const shopsQuery = trpc.shop.scores.useQuery({ limit: 1000 }, {
    // Оценка меняется от оплат и заказов, то есть медленно: чаще раза в пять
    // минут её перечитывать незачем, а карта обновляется каждые 30 секунд.
    staleTime: 5 * 60_000,
  });
  const shopScores = shopsQuery.data;

  /*
    День агентов: визиты, снимки и нормы.

    Один запрос на всех — getPlans без agentId отдаёт планы всей организации
    за дату, вместе с agentId, статусом, временем визита и ссылкой на
    фотоотчёт. Спрашивать по агенту значило бы десяток запросов на открытие
    экрана, который и так опрашивается каждые тридцать секунд.

    Обновляется реже карты: план на день составляют утром, и визит отмечают
    руками — минуты здесь достаточно, а точки нужны каждые полминуты.
  */
  const today = format(new Date(), "yyyy-MM-dd");
  const plansQuery = trpc.agent.getPlans.useQuery({ date: today }, { refetchInterval: 60_000 });
  const normsQuery = trpc.salesTarget.summary.useQuery(undefined, { staleTime: 5 * 60_000 });

  const [showShops, setShowShops] = useState(true);
  const [filter, setFilter] = useState<TrackedState | "all">("all");
  /**
   * Панель агентов сворачивается до заголовка.
   *
   * Она лежит НА карте и закрывает её левый край. Постоянно — плохо: карта
   * тут главное, и человеку нужен способ убрать с неё всё лишнее, не уходя
   * со страницы. Заголовок при этом остаётся на месте, иначе панель некуда
   * было бы вернуть.
   */
  const [railOpen, setRailOpen] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  /** Сколько меток магазинов сейчас правда нарисовано. */
  const [shownShops, setShownShops] = useState(0);
  /**
   * Готовность карты — состоянием, а не только ссылкой.
   *
   * ЗДЕСЬ И БЫЛО «видно 0 из 73». Карта создаётся внутри ymaps.ready, то есть
   * через сотни миллисекунд после монтирования, а эффекты, рисующие метки,
   * зависели только от данных. Ответы tRPC приходят раньше загрузки скрипта
   * Яндекса почти всегда: эффект просыпался, видел mapRef.current === null,
   * выходил — и больше не просыпался, потому что ref не вызывает перерисовку.
   *
   * У агентов это лечилось само: getLocations перезапрашивается каждые 30
   * секунд, и вторая попытка заставала карту готовой. У магазинов
   * перезапроса нет вовсе (staleTime пять минут), поэтому их метки не
   * появлялись НИКОГДА, а подпись под легендой честно докладывала «видно 0».
   * Совет «приблизьте карту» при этом был невыполним: приближать было нечего.
   */
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<null | "no-key" | "script">(YANDEX_MAPS_API_KEY ? null : "no-key");

  const mapRef        = useRef<YandexMap | null>(null);
  const mapDivRef     = useRef<HTMLDivElement>(null);
  const markersMapRef = useRef<Map<number, YandexPlacemark>>(new Map());
  const shopMarkersRef = useRef<Array<{ pm: YandexPlacemark; coords: number[]; visible: boolean }>>([]);
  const declutterRef  = useRef<(() => void) | null>(null);

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  /**
   * «Сейчас» — момент последнего успешного ответа, а не момент отрисовки.
   *
   * Так честнее (данные именно на это время) и заодно чинит замирание:
   * react-query возвращает ТУ ЖЕ ссылку на данные, когда ответ не изменился,
   * и memo, зависящий только от неё, у стоящего на месте агента больше не
   * пересчитывался бы никогда — «на связи» висело бы вечно.
   *
   * Ноль (успешного ответа ещё не было) отдаётся как undefined: время тогда
   * ставит сам buildRoster. Своё Date.now() здесь звать нельзя — отрисовка
   * обязана быть повторяемой, за этим следит react-hooks/purity.
   */
  const roster = useMemo(
    () => buildRoster(rosterQuery.data ?? [], locations ?? [], dataUpdatedAt || undefined),
    [rosterQuery.data, locations, dataUpdatedAt],
  );

  const agentPoints = useMemo(
    () => roster.rows.filter(r => r.lat != null && r.lng != null),
    [roster],
  );
  /** Магазины, которые вообще могут оказаться на карте. */
  const placedShops = useMemo(
    () => (shopScores ?? []).filter(s => s.lat != null && s.lng != null),
    [shopScores],
  );
  /**
   * Магазины без координат считаются отдельно.
   *
   * Знаменатель «видно 0 из 73» брался из всего ответа, а в него входят и
   * точки, у которых координат нет вовсе. Такой магазин на карте не появится
   * ни при каком приближении, и сравнивать с ним нарисованные метки — значит
   * обещать то, чего нет. Их теперь называют своим именем и отдельной
   * строкой: это не «карта не догрузилась», это «в справочнике не заполнено».
   */
  const shopsWithoutGps = (shopScores?.length ?? 0) - placedShops.length;

  const visibleRows = useMemo(
    () => filter === "all" ? roster.rows : roster.rows.filter(r => r.state === filter),
    [roster, filter],
  );

  // ── Карта ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!YANDEX_MAPS_API_KEY) return;
    let cancelled = false;

    const start = () => {
      const ymaps = window.ymaps;
      if (!ymaps) return;
      ymaps.ready(() => {
        const div = mapDivRef.current;
        if (cancelled || !div || mapRef.current) return;
        const map = new ymaps.Map(div, {
          center: DEFAULT_CENTER,
          zoom: 11,
          controls: ["zoomControl", "fullscreenControl", "geolocationControl"],
        });
        map.controls.get("zoomControl")?.options.set({ position: { right: 10, top: 10 } });
        map.controls.get("fullscreenControl")?.options.set({ position: { right: 10, top: 50 } });
        mapRef.current = map;
        setMapReady(true);
      });
    };

    if (window.ymaps) { start(); return () => { cancelled = true; }; }

    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_MAPS_API_KEY}&lang=ru_RU`;
    script.onload  = () => start();
    // Отказ загрузки и ненастроенный ключ — разные беды с разным лечением, а
    // сообщение было одно на оба: «Настройте VITE_YANDEX_MAPS_API_KEY» при
    // отсутствии интернета отправляло чинить то, что не сломано.
    script.onerror = () => setMapError("script");
    document.head.appendChild(script);
    return () => { cancelled = true; };
  }, []);

  /**
   * Подгон вида под то, что на карте есть.
   *
   * Прежде карта открывалась над Ташкентом на одиннадцатом масштабе и
   * подгонялась только под агентов. Агентов на этом экране обычно нет — и
   * вид оставался умозрительным: у организации из другого города в кадре не
   * было ни одной её точки, а человеку предлагали «приблизить карту».
   *
   * Люди важнее: если хоть кто-то делится, вид строится по ним. Магазины —
   * запасной ориентир, чтобы обзорный вид не оказался пустым полем.
   */
  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = agentPoints.length
      ? agentPoints.map(a => [a.lat as number, a.lng as number])
      : showShops ? placedShops.map(s => [s.lat as number, s.lng as number]) : [];
    const fit = boundsOf(source);
    if (!fit) return;
    if ("center" in fit) map.setCenter(fit.center, 14);
    else map.setBounds(fit.bounds, { checkZoomRange: true, zoomMargin: 48 });
  }, [agentPoints, placedShops, showShops]);

  /**
   * Подгон при открытии — и дальше только по кнопке.
   *
   * Подгон на каждом обновлении данных возвращал бы карту к общему виду
   * каждые тридцать секунд, отменяя всё, что человек только что приблизил.
   *
   * Исключение одно: магазины и люди приезжают разными запросами, и магазины
   * почти всегда первыми. Вид, построенный по магазинам, — временный; как
   * только появился хоть один агент, он строится заново по людям. Обратно
   * переигрывать нельзя: это уже отняло бы у человека вид, который он
   * смотрит.
   */
  const fittedRef = useRef<"none" | "shops" | "agents">("none");
  useEffect(() => {
    if (!mapReady || fittedRef.current === "agents") return;
    const want = agentPoints.length ? "agents" : placedShops.length ? "shops" : "none";
    if (want === "none" || want === fittedRef.current) return;
    fittedRef.current = want;
    fitAll();
  }, [mapReady, agentPoints, placedShops, fitAll]);

  // Метки агентов.
  useEffect(() => {
    const ymaps = window.ymaps;
    const map = mapRef.current;
    if (!ymaps || !map || !mapReady) return;

    ymaps.ready(() => {
      markersMapRef.current.forEach(m => map.geoObjects.remove(m));
      markersMapRef.current = new Map();

      agentPoints.forEach((agent) => {
        const name = agent.name ?? t("Агент", "Agent");
        // Значением, а не переменной: метка рисуется в data:-адресе, где
        // var(--…) не работает и кружок выходит чёрным — в сети агент или нет,
        // на карте выглядело одинаково.
        const color = agent.state === "online"
          ? cssVar("--color-success-text", "#157a45")
          : cssVar("--color-text-tertiary", "#6b6760");
        const initial = esc(name[0].toUpperCase());

        const placemark = new ymaps.Placemark(
          [agent.lat as number, agent.lng as number],
          {
            balloonContentHeader: `<b style="font-family:Inter,sans-serif;font-size:14px">${esc(name)}</b>`,
            balloonContentBody: `
              <div style="font-family:Inter,sans-serif;font-size:12px;color:#666;padding:4px 0">
                ${agent.state === "online" ? t("На связи", "Aloqada") : t("Был здесь", "Shu yerda edi")}
                ${agent.at ? ` — ${esc(format(agent.at, "dd.MM HH:mm"))}` : ""}
                ${agent.batteryLevel != null ? `<br/>🔋 ${agent.batteryLevel}%` : ""}
              </div>
            `,
            hintContent: esc(name),
          },
          {
            iconLayout: "default#imageWithContent",
            iconImageHref: `data:image/svg+xml,${encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="18" fill="${color}" stroke="white" stroke-width="3"/>
                <circle cx="20" cy="20" r="18" fill="none" stroke="${color}" stroke-width="1" opacity="0.3">
                  <animate attributeName="r" from="18" to="24" dur="2s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" from="0.3" to="0" dur="2s" repeatCount="indefinite"/>
                </circle>
                <text x="20" y="25" text-anchor="middle" fill="white" font-family="Inter,sans-serif" font-weight="700" font-size="15">${initial}</text>
              </svg>
            `)}`,
            iconImageSize: [40, 40],
            iconImageOffset: [-20, -20],
            balloonPanelMaxMapArea: 0,
          },
        );

        map.geoObjects.add(placemark);
        markersMapRef.current.set(agent.id, placemark);
      });
    });
  }, [agentPoints, mapReady, t]);

  // Магазины отдельным эффектом: они меняются раз в пять минут, а метки
  // агентов — каждые тридцать секунд. В одном эффекте пришлось бы
  // перерисовывать всё вместе, и карта дёргалась бы на каждом опросе.
  useEffect(() => {
    const ymaps = window.ymaps;
    const map = mapRef.current;
    if (!ymaps || !map || !mapReady) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Снять метки магазинов и отписаться от карты. */
    const clear = () => {
      clearTimeout(timer);
      if (declutterRef.current) {
        map.events.remove("boundschange", declutterRef.current);
        declutterRef.current = null;
      }
      shopMarkersRef.current.forEach(m => map.geoObjects.remove(m.pm));
      shopMarkersRef.current = [];
    };

    ymaps.ready(() => {
      clear();
      if (!showShops || placedShops.length === 0) {
        setShownShops(0);
        return;
      }

      // Анимация — только пока меток немного: каждая метка отдельная картинка,
      // и её SMIL браузер считает сам.
      const animated = placedShops.length <= PIN_ANIMATION_LIMIT;

      // Порядок решает, кто останется на экране, когда места мало: сначала
      // «долго не платят», потом «есть долг» и так далее. Проблемный магазин
      // не должен быть тем, кого заслонили.
      const ordered = [...placedShops].sort((a, b) => {
        const ta: ShopTier = a.tier in TIER_COLOR ? (a.tier as ShopTier) : "new";
        const tb: ShopTier = b.tier in TIER_COLOR ? (b.tier as ShopTier) : "new";
        return TIER_ORDER.indexOf(ta) - TIER_ORDER.indexOf(tb);
      });

      const markers = ordered.map((shop) => {
        // Незнакомый разряд с сервера — как «заказов не было»: серая метка
        // честнее пустого значка и падения на выборе подписи.
        const tier: ShopTier = shop.tier in TIER_COLOR ? (shop.tier as ShopTier) : "new";
        const color = TIER_COLOR[tier];
        const pm = new ymaps.Placemark(
          [shop.lat as number, shop.lng as number],
          {
            balloonContentHeader: `<b style="font-family:Inter,sans-serif;font-size:14px">${esc(shop.name)}</b>`,
            balloonContentBody: `
              <div style="font-family:Inter,sans-serif;font-size:12px;color:#666;padding:4px 0;line-height:1.6">
                <div><b style="color:${color}">${esc(TIER_LABEL[tier].ru)}</b> — ${esc(shop.reason)}</div>
                <div>Принёс за всё время: <b>${esc(fmt(shop.ltv))}</b></div>
                <div>Заказов: ${shop.orderCount}${shop.debt > 0 ? ` · долг ${esc(fmt(shop.debt))}` : ""}</div>
              </div>
            `,
            hintContent: `${esc(shop.name)} — ${esc(fmt(shop.ltv, true))}`,
          },
          {
            // Булавка со значком лавки, а не круг: круги на этой карте заняты
            // агентами, и две роли не должны выглядеть одинаково.
            iconLayout: "default#imageWithContent",
            iconImageHref: `data:image/svg+xml,${encodeURIComponent(shopPinSvg(color, animated))}`,
            iconImageSize: PIN_SIZE,
            // Привязка к острию: метка стоит на своём адресе, а не парит над
            // ним центром картинки.
            iconImageOffset: PIN_ANCHOR,
            balloonPanelMaxMapArea: 0,
            // Ниже меток агентов: люди важнее точек, их метка не должна
            // оказаться под магазином.
            zIndex: 100,
          },
        );
        map.geoObjects.add(pm);
        return { pm, coords: [shop.lat as number, shop.lng as number], visible: true };
      });
      shopMarkersRef.current = markers;

      const declutter = () => {
        const div = mapDivRef.current;
        if (!div) return;
        const projection = map.options.get("projection");
        const zoom = map.getZoom();
        // Окно карты в координатах СТРАНИЦЫ — ровно в тех, что отдаёт
        // globalToPage. Раньше здесь стоял container.getSize(), то есть
        // размер контейнера от его собственного угла, и метки правее и ниже
        // середины карты объявлялись «за краем экрана» и пропадали.
        const rect = div.getBoundingClientRect();
        const view = {
          left:   rect.left + window.scrollX,
          top:    rect.top  + window.scrollY,
          width:  rect.width,
          height: rect.height,
        };
        const points = markers.map((m) => {
          const [x, y] = map.converter.globalToPage(projection.toGlobalPixels(m.coords, zoom));
          return { x, y };
        });

        const visible = visiblePins(points, view, PIN_FOOTPRINT);
        let shown = 0;
        visible.forEach((v, i) => {
          if (v) shown++;
          // Трогаем метку, только если её состояние правда меняется: карта
          // перерисовывает объект на каждый set, и лишние вызовы дёргают её
          // при обычном перетаскивании.
          if (v !== markers[i].visible) {
            markers[i].visible = v;
            markers[i].pm.options.set("visible", v);
          }
        });
        setShownShops(shown);
      };

      // Пересчёт после того, как карта остановилась: во время перетаскивания
      // boundschange приходит на каждый кадр.
      const onBoundsChange = () => {
        clearTimeout(timer);
        timer = setTimeout(declutter, 120);
      };
      map.events.add("boundschange", onBoundsChange);
      declutterRef.current = onBoundsChange;
      declutter();
    });

    // Уход со страницы: карта живёт дольше эффекта, и подписка на неё без
    // этого пережила бы компонент.
    return clear;
  }, [placedShops, showShops, mapReady, fmt]);

  /**
   * День каждого агента — из планов и норм, по одному разу на приход данных.
   *
   * Ключ — agentId, потому что и планы, и нормы приходят на него. Агент без
   * плана на сегодня в карте отсутствует, и панель об этом скажет словами:
   * «плана на день нет» — это ответ, а ноль из нуля им не был бы.
   */
  /**
   * День каждого агента — из планов, по одному разу на приход данных.
   *
   * Сама сборка вынесена в agent-day.ts: это единственное место экрана, где
   * что-то считается, а не рисуется, и проверять её на странице целиком
   * значило бы поднимать tRPC, карту и Яндекс ради одного цикла.
   */
  const dayByAgent = useMemo(
    () => buildAgentDays(plansQuery.data, t("Магазин", "Do'kon")),
    [plansQuery.data, t],
  );

  const normByAgent = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of normsQuery.data ?? []) map.set(row.userId, row.revenueCompletion);
    return map;
  }, [normsQuery.data]);

  /** То же, что нужно строке списка: обход и норма без снимков. */
  const railDay = useMemo(() => {
    const map = new Map<number, { visited: number; planned: number; normPct: number | null }>();
    for (const [agentId, d] of dayByAgent) {
      map.set(agentId, { visited: d.visited, planned: d.planned, normPct: normByAgent.get(agentId) ?? null });
    }
    return map;
  }, [dayByAgent, normByAgent]);

  /*
    Маршрут выбранного агента за сегодня.

    Запрашивается только когда кого-то выбрали: точек за день у одного
    человека несколько сотен, и тянуть их на всех разом незачем — линия
    рисуется по одному.
  */
  const trailQuery = trpc.agent.getTrail.useQuery(
    { agentId: selected ?? 0, date: today },
    { enabled: selected != null, refetchInterval: 60_000 },
  );

  /** Точки маршрута в том виде, в каком их принимает карта. */
  const trailPoints = useMemo(() => {
    return (trailQuery.data ?? [])
      .map(p => [Number(p.lat), Number(p.lng)] as [number, number])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  }, [trailQuery.data]);

  // Пройдено за день — по тем же точкам, что рисуют линию, и той же формулой,
  // что считает расстояние сервер: иначе на одну поездку вышло бы два разных
  // километража.
  const trailKm = useMemo(() => pathLengthKm(trailPoints), [trailPoints]);

  /*
    Линия маршрута на карте, прочерчивается от начала дня к текущей точке.

    Рисуется одним объектом, который перестраивается по мере прорисовки:
    добавлять по точке отдельными объектами значило бы класть на карту
    несколько сотен геообъектов и ронять её на телефоне.

    Прорисовка останавливается при смене выбора: иначе две анимации по
    очереди перестраивали бы один и тот же объект.
  */
  const trailRef = useRef<YandexPolyline | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const clear = () => {
      if (trailRef.current) {
        map.geoObjects.remove(trailRef.current);
        trailRef.current = null;
      }
    };
    clear();
    if (selected == null || trailPoints.length < 2) return;

    const ymaps = window.ymaps;
    if (!ymaps) return;

    const line = new ymaps.Polyline([], {}, {
      strokeColor: cssVar("--color-primary", "#3b6ea5"),
      strokeWidth: 4,
      strokeOpacity: 0.75,
      // Линия уходит под метки: маршрут — это фон для точек, а не наоборот.
      zIndex: 100,
    });
    map.geoObjects.add(line);
    trailRef.current = line;

    const anim = drawTrail(progress => {
      const upto = Math.max(2, Math.round(trailPoints.length * progress));
      line.geometry.setCoordinates(trailPoints.slice(0, upto));
    });

    return () => { anim.cancel(); clear(); };
  }, [selected, trailPoints, mapReady]);

  // Центрирование на выбранном агенте — только при смене выбора. Метки
  // приходят каждые тридцать секунд; зависи эффект от них, карта
  // возвращалась бы к агенту на каждом опросе, пока человек её двигает.
  // Поэтому свежие координаты читаются через ref, а не из зависимостей.
  const pointsRef = useRef(agentPoints);
  useEffect(() => { pointsRef.current = agentPoints; }, [agentPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (selected == null || !map || !mapReady) return;
    const agent = pointsRef.current.find(a => a.id === selected);
    if (!agent) return;
    map.setCenter([agent.lat as number, agent.lng as number], 15);
    markersMapRef.current.get(selected)?.balloon.open();
  }, [selected, mapReady]);

  // ── Разметка ──────────────────────────────────────────────────────────────

  const { counts } = roster;

  /**
   * Фильтр вместо трёх плиток.
   *
   * Плитки «ОНЛАЙН / НЕ В СЕТИ / ВСЕГО» занимали четверть экрана и ничего не
   * предлагали сделать. Те же числа стоят здесь строкой и одновременно
   * работают переключателем списка: «покажи мне тех, кто на связи» — это и
   * есть вопрос, с которым сюда приходят.
   */
  const buckets: Array<{ key: TrackedState | "all"; label: string; count: number; tint?: TrackedState }> = [
    { key: "all",    label: t("Все", "Hammasi"),           count: counts.total },
    { key: "online", label: t("На связи", "Aloqada"),      count: counts.online, tint: "online" },
    { key: "stale",  label: t("Были раньше", "Avvalroq"),  count: counts.stale,  tint: "stale" },
    { key: "silent", label: t("Без сигнала", "Signalsiz"), count: counts.silent, tint: "silent" },
  ];

  return (
    <div className="space-y-3 animate-fade-up">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
            {t("Слежение за агентами", "Agentlarni kuzatish")}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: stalled ? "var(--color-warning-text)" : "var(--color-text-tertiary)" }}>
            {failed
              ? t("Связь с сервером потеряна", "Server bilan aloqa uzildi")
              : lastUpdate
                ? `${t("Обновлено", "Yangilangan")} ${format(lastUpdate, "HH:mm:ss")}`
                  + (stalled ? t(" · последний опрос не прошёл", " · so'nggi so'rov o'tmadi") : "")
                : t("Загружаем…", "Yuklanmoqda…")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!failed && !stalled && (
            <div className="flex items-center gap-1.5">
              <Radio size={13} className="text-success animate-pulse" />
              <span className="font-label text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                {t("ПРЯМОЙ ЭФИР · 30 сек", "JONLI · 30 sek")}
              </span>
            </div>
          )}
          <button onClick={() => refetch()} className="neo-btn neo-btn-sm tap flex items-center gap-1.5">
            <RefreshCw size={12} />{t("Обновить", "Yangilash")}
          </button>
        </div>
      </div>

      {/* Строка состояния — она же фильтр списка. */}
      <div className="neo-card-sm flex items-center gap-2 flex-wrap" style={{ padding: "8px 12px" }}>
        {failed ? (
          <span className="text-xs" style={{ color: "var(--color-danger-text)" }}>
            {t("Местоположения не загрузились — это сбой связи, а не молчание агентов.",
               "Joylashuvlar yuklanmadi — bu aloqa uzilishi, agentlar sukuti emas.")}
          </span>
        ) : counts.total === 0 && !isLoading && !rosterQuery.isLoading ? (
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {t("В организации нет активных агентов", "Tashkilotda faol agent yo'q")}
          </span>
        ) : (
          <>
            {buckets.map(b => {
              const active = filter === b.key;
              const tint = b.tint ? cssVar(...STATE_TINT[b.tint]) : null;
              return (
                <button
                  key={b.key}
                  onClick={() => setFilter(b.key)}
                  aria-pressed={active}
                  className="neo-btn neo-btn-sm tap flex items-center gap-1.5"
                  style={{
                    boxShadow: active ? "var(--shadow-pressed)" : undefined,
                    color: active ? "var(--color-primary-text)" : "var(--color-text-secondary)",
                  }}
                >
                  {tint && <span style={{ width: 7, height: 7, borderRadius: "50%", background: tint }} />}
                  {b.label}
                  <b className="font-data" style={{ color: "var(--color-text-primary)" }}>{b.count}</b>
                </button>
              );
            })}
            <span className="text-xs ml-auto" style={{ color: "var(--color-text-tertiary)" }}>
              {roster.lastSignalAt
                ? `${t("Последний сигнал", "Oxirgi signal")}: ${timeAgo(roster.lastSignalAt, lang)}`
                : t("За сутки ни одного сигнала", "Sutka davomida signal yo'q")}
            </span>
          </>
        )}
      </div>

      <div className="neo-card neo-card-static" style={{ padding: 0, position: "relative", overflow: "hidden" }}>
        {/* Панель карты.
            Цвет без подписи — ребус: красная точка на карте может означать
            что угодно, от долга до отсутствия связи. */}
        <div className="flex items-center gap-2 flex-wrap px-3 py-2"
             style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
          <button onClick={fitAll} className="neo-btn neo-btn-sm tap flex items-center gap-1.5"
                  disabled={!mapReady || (agentPoints.length === 0 && placedShops.length === 0)}>
            <Maximize2 size={13} />{t("Показать всех", "Hammasini ko'rsatish")}
          </button>
          <button onClick={() => setShowShops(v => !v)}
                  className="neo-btn neo-btn-sm tap flex items-center gap-1.5"
                  aria-pressed={showShops}
                  style={showShops
                    ? { boxShadow: "var(--shadow-pressed)", color: "var(--color-primary-text)" }
                    : undefined}>
            <Store size={13} />{t("Магазины", "Do'konlar")}
          </button>

          {showShops && TIER_ORDER.map(tier => {
            // Легенда считает то, что НА КАРТЕ. Прежде она складывала весь
            // ответ сервера, включая магазины без координат: «Есть долг 4»
            // стояло рядом с картой, на которой не было ни одной метки.
            const count = placedShops.filter(s => s.tier === tier).length;
            if (count === 0) return null;
            return (
              <span key={tier} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-text-secondary)" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: TIER_COLOR[tier], flexShrink: 0 }} />
                {t(TIER_LABEL[tier].ru, TIER_LABEL[tier].uz)}
                <b style={{ color: "var(--color-text-primary)" }}>{count}</b>
              </span>
            );
          })}

          <span className="text-xs ml-auto flex items-center gap-1.5" style={{ color: "var(--color-text-tertiary)" }}>
            {shopsQuery.isError ? (
              <>
                <span style={{ color: "var(--color-danger-text)" }}>
                  {t("Магазины не загрузились", "Do'konlar yuklanmadi")}
                </span>
                <button onClick={() => shopsQuery.refetch()} className="neo-btn neo-btn-sm tap">
                  {t("Повторить", "Qayta urinish")}
                </button>
              </>
            ) : !showShops ? null
              : shopsQuery.isLoading ? t("Магазины загружаются…", "Do'konlar yuklanmoqda…")
              /* Пока карты нет, счётчик нарисованных меток равен нулю по
                 совершенно другой причине — и «видно 0 из 73» снова обещало
                 бы, что дело в приближении. */
              : !mapReady ? null
              : shownShops < placedShops.length ? (
                /* Метки не пропали — просто не поместились. Без этой строки
                   «показано 70 из 500» выглядело бы как потерянные магазины. */
                t(`Видно ${shownShops} из ${placedShops.length} — приблизьте карту`,
                  `${placedShops.length} tadan ${shownShops} ta ko'rinadi — yaqinlashtiring`)
              ) : placedShops.length > 0 ? (
                t(`Все ${placedShops.length} на карте`, `Hammasi xaritada: ${placedShops.length}`)
              ) : null}
            {shopsWithoutGps > 0 && showShops && !shopsQuery.isError && (
              <span title={t("Координаты магазина заполняются в его карточке", "Koordinatalar do'kon kartochkasida to'ldiriladi")}
                    className="flex items-center gap-1">
                <Info size={12} />
                {t(`${shopsWithoutGps} без координат`, `${shopsWithoutGps} ta koordinatasiz`)}
              </span>
            )}
          </span>
        </div>

        <div style={{ position: "relative" }}>
          {mapError ? (
            <div className="flex flex-col items-center justify-center text-center p-6" style={{ height: MAP_HEIGHT }}>
              <MapPin size={32} className="mb-3 opacity-30" style={{ color: "var(--color-text-tertiary)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
                {mapError === "no-key"
                  ? t("Ключ карты не настроен", "Xarita kaliti sozlanmagan")
                  : t("Карта не загрузилась", "Xarita yuklanmadi")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
                {mapError === "no-key"
                  ? "VITE_YANDEX_MAPS_API_KEY"
                  : t("Проверьте подключение к интернету и обновите страницу",
                      "Internet aloqasini tekshiring va sahifani yangilang")}
              </p>
            </div>
          ) : (
            /* zIndex: 0 запирает слои Яндекса внутри карты: её собственные
               панели идут с z-index в сотни, и без своего контекста они
               накрыли бы панель агентов, лежащую сверху. */
            <div ref={mapDivRef} style={{ width: "100%", height: MAP_HEIGHT, position: "relative", zIndex: 0 }} />
          )}

          {/*
            День выбранного агента — правым нижним углом карты.

            Справа, а не слева: слева уже лежит список, и две панели по одному
            краю сложились бы в колонку, отобрав у карты половину. Внизу, а не
            вверху: сверху над картой идёт строка отбора и легенда.
          */}
          {selected != null && (
            <div className="mt-3 lg:mt-0 lg:absolute lg:right-3 lg:bottom-3 lg:w-[280px] lg:z-10">
              <AgentDayPanel
                name={visibleRows.find(r => r.id === selected)?.name
                  ?? `${t("Агент", "Agent")} #${selected}`}
                loading={plansQuery.isLoading}
                onPhotoOpen={url => window.open(url, "_blank", "noopener,noreferrer")}
                t={t}
                day={{
                  visited: dayByAgent.get(selected)?.visited ?? 0,
                  planned: dayByAgent.get(selected)?.planned ?? 0,
                  photos: dayByAgent.get(selected)?.photos ?? [],
                  normPct: normByAgent.get(selected) ?? null,
                  battery: visibleRows.find(r => r.id === selected)?.batteryLevel ?? null,
                  distanceKm: trailKm,
                }}
              />
            </div>
          )}

          {/* Список агентов лежит НА карте, а не отбирает у неё треть ширины.
              На узком экране он уходит под карту обычным блоком. */}
          <AgentRail
            rows={visibleRows}
            day={railDay}
            silentCount={counts.silent}
            filtered={filter !== "all"}
            onResetFilter={() => setFilter("all")}
            title={filter === "all"
              ? t("АГЕНТЫ", "AGENTLAR")
              : buckets.find(b => b.key === filter)?.label.toUpperCase() ?? ""}
            open={railOpen}
            onToggle={() => setRailOpen(v => !v)}
            failed={failed}
            loading={isLoading || rosterQuery.isLoading}
            onRetry={() => refetch()}
            selected={selected}
            onSelect={setSelected}
            lang={lang}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}


// Yandex Maps type declarations — only the surface this app actually calls.
declare global {
  interface YandexPlacemark {
    balloon: { open(): void };
    options: { set(name: string, value: unknown): void };
  }

  /** Пересчёт координат в пиксели — из него и растёт разведение меток. */
  interface YandexProjection {
    toGlobalPixels(coords: number[], zoom: number): number[];
  }

  interface YandexMap {
    geoObjects: {
      add(object: YandexPlacemark | YandexPolyline): void;
      remove(object: YandexPlacemark | YandexPolyline): void;
      /** null, пока на карте нет ни одного объекта. Нужен CourierDeliveries:
          описание карты здесь общее для всех страниц, и убирать из него метод,
          которым пользуется соседняя, нельзя. */
      getBounds(): number[][] | null;
    };
    controls: {
      get(name: string): {
        options: { set(options: { position: { left?: number; right?: number; top?: number; bottom?: number } }): void };
      } | undefined;
    };
    setBounds(bounds: number[][], options?: { checkZoomRange?: boolean; zoomMargin?: number }): void;
    setCenter(center: number[], zoom?: number): void;
    getZoom(): number;
    container: { getSize(): number[] };
    converter: { globalToPage(globalPixels: number[]): number[] };
    options: { get(name: "projection"): YandexProjection };
    events: {
      add(type: string, handler: () => void): void;
      remove(type: string, handler: () => void): void;
    };
  }

  /** Ломаная маршрута: геометрия перестраивается по мере прорисовки. */
  interface YandexPolyline {
    geometry: { setCoordinates(coords: number[][]): void };
  }

  interface YandexMaps {
    ready(callback: () => void): void;
    Map: new (element: HTMLElement, options: { center: number[]; zoom: number; controls?: string[] }) => YandexMap;
    Placemark: new (
      geometry: number[],
      properties: { balloonContentHeader?: string; balloonContentBody?: string; hintContent?: string },
      options: {
        iconLayout?: string;
        iconImageHref?: string;
        iconImageSize?: number[];
        iconImageOffset?: number[];
        balloonPanelMaxMapArea?: number;
        /** Метки магазинов уводятся под метки агентов: люди важнее точек. */
        zIndex?: number;
      },
    ) => YandexPlacemark;
    Polyline: new (
      geometry: number[][],
      properties: Record<string, unknown>,
      options: {
        strokeColor?: string;
        strokeWidth?: number;
        strokeOpacity?: number;
        zIndex?: number;
      },
    ) => YandexPolyline;
  }

  interface Window {
    // Absent until the api-maps.yandex.ru script has loaded.
    ymaps?: YandexMaps;
  }
}
