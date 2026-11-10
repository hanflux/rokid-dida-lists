# Dida Lists Agent

## Identity
- **Name**: 滴答清单
- **Version**: 1.0.0
- **Description**: 直接读取滴答清单（Dida365）里的任务，按逾期/今天/明天/以后分组显示在眼镜上。

## Capabilities
- **Permissions**:
  - network
  - microphone
- **Skills**:
  - speech-synthesis

## Notes

- 数据源是滴答清单官方 Open API（`https://api.dida365.com/open/v1`），眼镜直连，不经过任何服务器。
- 访问令牌保存在本地 storage，首次运行若缺失则显示引导页。
- 单色绿屏：颜色不能承载语义，逾期/优先级一律用图标与文字标签表达。
