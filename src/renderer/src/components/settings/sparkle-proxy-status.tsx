import React, { useEffect, useState } from 'react'
import { Button, Input, Switch, Tooltip } from '@heroui/react'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import EditableList from '../base/base-list-editor'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  resetExtensionApiToken,
  restartExtensionApiServer,
  writeClipboardText
} from '@renderer/utils/ipc'
import { IoIosHelpCircle } from 'react-icons/io'
import { BiCopy } from 'react-icons/bi'

const emptyArray: string[] = []

function isSameStringList(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

const SparkleProxyStatus: React.FC = () => {
  const { appConfig, patchAppConfig, mutateAppConfig } = useAppConfig()
  const {
    extensionApiEnabled = false,
    extensionApiPort = 14123,
    extensionApiToken = '',
    extensionApiAllowedOrigins
  } = appConfig || {}
  const allowedOrigins = extensionApiAllowedOrigins ?? emptyArray
  const [allowedOriginsInput, setAllowedOriginsInput] = useState(allowedOrigins)
  const [portInput, setPortInput] = useState(extensionApiPort)

  useEffect(() => {
    setAllowedOriginsInput(allowedOrigins)
  }, [allowedOrigins])

  useEffect(() => {
    setPortInput(extensionApiPort)
  }, [extensionApiPort])

  return (
    <SettingCard title="Sparkle Proxy Status">
      <SettingItem
        title="浏览器扩展 API"
        actions={
          <Tooltip content="仅监听 127.0.0.1，只读查询；必须携带 Bearer Token。建议同时配置允许的扩展 Origin。">
            <Button isIconOnly size="sm" variant="light">
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          isSelected={extensionApiEnabled}
          onValueChange={async (enabled) => {
            try {
              await patchAppConfig({ extensionApiEnabled: enabled })
              await restartExtensionApiServer()
              mutateAppConfig()
            } catch (error) {
              alert(error)
            }
          }}
        />
      </SettingItem>

      {extensionApiEnabled && (
        <>
          <SettingItem title="扩展 API 端口" divider>
            <div className="flex">
              {portInput !== extensionApiPort && (
                <Button
                  size="sm"
                  color="primary"
                  className="mr-2"
                  onPress={async () => {
                    try {
                      const port = Math.min(65535, Math.max(1, portInput))
                      await patchAppConfig({ extensionApiPort: port })
                      await restartExtensionApiServer()
                      mutateAppConfig()
                    } catch (error) {
                      alert(error)
                    }
                  }}
                >
                  确认
                </Button>
              )}
              <Input
                size="sm"
                type="number"
                className="w-[120px]"
                value={portInput.toString()}
                min={1}
                max={65535}
                onValueChange={(value) => {
                  const port = parseInt(value)
                  setPortInput(Number.isFinite(port) ? port : 0)
                }}
              />
            </div>
          </SettingItem>

          <SettingItem
            title="扩展 API Token"
            actions={
              <div className="flex items-center gap-1">
                <Button
                  title="复制"
                  isIconOnly
                  size="sm"
                  variant="light"
                  onPress={async () => {
                    try {
                      await writeClipboardText(extensionApiToken)
                    } catch (error) {
                      alert(error)
                    }
                  }}
                >
                  <BiCopy className="text-lg" />
                </Button>
                <Button
                  size="sm"
                  variant="light"
                  onPress={async () => {
                    try {
                      await resetExtensionApiToken()
                      mutateAppConfig()
                    } catch (error) {
                      alert(error)
                    }
                  }}
                >
                  重置
                </Button>
              </div>
            }
            divider
          >
            <Input
              size="sm"
              className="w-[260px]"
              type="text"
              value={extensionApiToken}
              isReadOnly
            />
          </SettingItem>

          <SettingItem
            title="允许的 Origin"
            actions={
              <Tooltip content="留空表示不做 Origin 白名单校验；建议填 chrome-extension://&lt;你的扩展 ID&gt;">
                <Button isIconOnly size="sm" variant="light">
                  <IoIosHelpCircle className="text-lg" />
                </Button>
              </Tooltip>
            }
          >
            {!isSameStringList(allowedOriginsInput, allowedOrigins) && (
              <Button
                size="sm"
                color="primary"
                onPress={async () => {
                  try {
                    await patchAppConfig({ extensionApiAllowedOrigins: allowedOriginsInput })
                    await restartExtensionApiServer()
                    mutateAppConfig()
                  } catch (error) {
                    alert(error)
                  }
                }}
              >
                确认
              </Button>
            )}
          </SettingItem>
          <EditableList
            items={allowedOriginsInput}
            onChange={(list) => setAllowedOriginsInput(list as string[])}
            divider={false}
          />
        </>
      )}
    </SettingCard>
  )
}

export default SparkleProxyStatus
