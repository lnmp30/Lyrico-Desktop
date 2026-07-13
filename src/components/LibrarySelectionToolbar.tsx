import { CloudSyncOutlined } from "@ant-design/icons";
import { Button, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";

const { Text } = Typography;

export function LibrarySelectionToolbar({ selectedCount, onOpenBatch }: { selectedCount: number; onOpenBatch: () => void }) {
  const { t } = useTranslation();
  return (
    <Flex className="selection-toolbar" align="center" justify="space-between" gap={12} wrap>
      <Text>{t("selection.count", { count: selectedCount })}</Text>
      <Button type="primary" icon={<CloudSyncOutlined />} disabled={selectedCount === 0} onClick={onOpenBatch}>
        {t("selection.batch")}
      </Button>
    </Flex>
  );
}
