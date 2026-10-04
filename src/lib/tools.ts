/**
 * 在线小工具注册表（单一数据源）
 *
 * 加一个新工具只要两步：
 *   1. 在 src/pages/tools/ 下建一个 <slug>.astro
 *   2. 在下面的数组里加一项
 * 工具列表页和每个工具页底部的「其他工具」都从这儿取，不会出现两处不同步。
 */

export interface ToolMeta {
  /** 对应 src/pages/tools/<slug>.astro */
  slug: string;
  name: string;
  /** 一句话说明，同时用作页面 description */
  description: string;
  /** 一个 emoji 当图标 */
  icon: string;
  tags: string[];
}

export const TOOLS: ToolMeta[] = [
  {
    slug: 'json',
    name: 'JSON 格式化',
    description: '格式化、压缩、校验 JSON，报错时告诉你具体哪里不对。',
    icon: '🧾',
    tags: ['开发'],
  },
  {
    slug: 'timestamp',
    name: '时间戳转换',
    description: 'Unix 时间戳与日期时间互转，自动识别秒和毫秒。',
    icon: '⏱️',
    tags: ['开发'],
  },
  {
    slug: 'base64',
    name: 'Base64 编解码',
    description: '文本与 Base64 互转，中文和 emoji 都不会乱码。',
    icon: '🔐',
    tags: ['开发', '文本'],
  },
  {
    slug: 'color',
    name: '颜色格式转换',
    description: 'HEX、RGB、HSL 三种颜色格式互转，带实时预览。',
    icon: '🎨',
    tags: ['设计'],
  },
];

/** 按 slug 取工具信息 */
export function getTool(slug: string): ToolMeta | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}

/** 除自己以外的工具 */
export function getOtherTools(slug: string): ToolMeta[] {
  return TOOLS.filter((tool) => tool.slug !== slug);
}

/** 所有出现过的标签 */
export function getAllTags(): string[] {
  return [...new Set(TOOLS.flatMap((tool) => tool.tags))];
}
