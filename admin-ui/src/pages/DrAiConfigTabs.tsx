import { Tabs } from "antd";
import DrAiConfig from "./DrAiConfig";
import DrAiQuotaManagement from "./DrAiQuotaManagement";

export default function DrAiConfigTabs() {
  return (
    <Tabs
      defaultActiveKey="vendor"
      items={[
        {
          key: "vendor",
          label: "厂商配置",
          children: <DrAiConfig />,
        },
        {
          key: "quota",
          label: "AI 配额",
          children: <DrAiQuotaManagement />,
        },
      ]}
    />
  );
}
