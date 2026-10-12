import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
// react-leaflet-cluster v4 以 default export 暴露 MarkerClusterGroup
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { getCompanies } from '@client/src/api/restaurants';
import type { Company } from '@shared/api.interface';
import { useI18n } from '@/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// 打包器（Vite 等）会丢掉 Leaflet 默认图标的图片引用，这里从包内资源显式补上，
// 否则所有 marker 都没有图钉图标。
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

type MapTabProps = { projectId: string };

function hasCoords(c: Company): boolean {
  const lat = Number(c.latitude);
  const lng = Number(c.longitude);
  return (
    c.latitude !== null &&
    c.latitude !== undefined &&
    c.longitude !== null &&
    c.longitude !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  );
}

/** 拉取项目下全部公司：分页循环直到取满 total（服务端无 pageSize 上限） */
async function fetchAllCompanies(projectId: string): Promise<Company[]> {
  const first = await getCompanies({ projectId, page: 1, pageSize: 1000 });
  const items: Company[] = [...(first.items ?? [])];
  const total = typeof first.total === 'number' ? first.total : items.length;
  let page = 1;
  while (items.length < total && page < 100) {
    page += 1;
    const next = await getCompanies({ projectId, page, pageSize: 1000 });
    if (!next.items?.length) break;
    items.push(...next.items);
  }
  return items;
}

/** 数据就绪后把视野调整到包含全部标注点，避免有点落在视野外看不见 */
function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(points, { padding: [40, 40] });
  }, [map, points]);
  return null;
}

export default function MapTab({ projectId }: MapTabProps) {
  const { t } = useI18n();

  const {
    data: companies,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['map-companies', projectId],
    queryFn: () => fetchAllCompanies(projectId),
    staleTime: 60_000,
  });

  const list = companies ?? [];

  const { located, missing, points } = useMemo(() => {
    const locatedList: Company[] = [];
    const missingList: Company[] = [];
    for (const c of list) {
      if (hasCoords(c)) locatedList.push(c);
      else missingList.push(c);
    }
    const pts = locatedList.map(
      (c) => [Number(c.latitude), Number(c.longitude)] as [number, number],
    );
    return { located: locatedList, missing: missingList, points: pts };
  }, [list]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-5 space-y-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-[520px] w-full rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-red-600">{t('加载地图数据失败，请刷新重试')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 统计条：强调"全部公司"都在图上 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-slate-100 px-3 py-1.5 font-medium text-slate-700">
          {t('全部')} {list.length}
        </span>
        <span className="rounded-md bg-green-50 px-3 py-1.5 font-medium text-green-700 border border-green-200">
          {t('已标注')} {located.length}
        </span>
        {missing.length > 0 && (
          <span className="rounded-md bg-amber-50 px-3 py-1.5 font-medium text-amber-700 border border-amber-200">
            {t('未标注（缺少经纬度）')} {missing.length}
          </span>
        )}
      </div>

      {located.length === 0 ? (
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">
              {list.length === 0
                ? t('暂无公司数据，请先导入公司名录')
                : t('所有公司都缺少经纬度，无法在地图上标注。导入时请包含「纬度 Lat」「经度 Lng」列。')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <MapContainer
            center={[located.length > 0 ? Number(located[0].latitude) : 20, located.length > 0 ? Number(located[0].longitude) : 0]}
            zoom={6}
            scrollWheelZoom
            preferCanvas
            style={{ height: 520, width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />
            <FitBounds points={points} />
            <MarkerClusterGroup chunkedLoading>
              {located.map((c) => (
                <Marker key={c.id} position={[Number(c.latitude), Number(c.longitude)]}>
                  <Popup>
                    <div className="space-y-1 text-sm" style={{ minWidth: 220 }}>
                      <p className="font-semibold text-slate-800">{c.name}</p>
                      {c.address && (
                        <p className="text-slate-600">
                          {t('地址')}：{c.address}
                        </p>
                      )}
                      {c.phone && (
                        <p className="text-slate-600">
                          {t('电话')}：{c.phone}
                        </p>
                      )}
                      {c.email && (
                        <p className="text-slate-600">
                          {t('邮箱')}：{c.email}
                        </p>
                      )}
                      {c.website && (
                        <p>
                          <a
                            href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline break-all"
                          >
                            {c.website}
                          </a>
                        </p>
                      )}
                      <p>
                        <Link
                          to={`/compose/${c.id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {t('撰写邮件')} →
                        </Link>
                      </p>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>
        </div>
      )}

      {missing.length > 0 && located.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">
              {t('未标注（缺少经纬度）')}：{missing.map((c) => c.name).join('、')}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
