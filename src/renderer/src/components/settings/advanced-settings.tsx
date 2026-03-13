import React, { useState, useEffect } from 'react'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Button, Input, Select, SelectItem, Switch, Tab, Tabs, Tooltip } from '@heroui/react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  copyEnv,
  patchControledMihomoConfig,
  restartCore,
  resetExtensionApiToken,
  restartExtensionApiServer,
  startNetworkDetection,
  stopNetworkDetection
} from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'
import { IoIosHelpCircle } from 'react-icons/io'
import { BiCopy } from 'react-icons/bi'
import EditableList from '../base/base-list-editor'

const emptyArray: string[] = []

function isSameStringList(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

const AdvancedSettings: React.FC = () => {
  const { appConfig, patchAppConfig, mutateAppConfig } = useAppConfig()
  const {
    controlDns = true,
    controlSniff = true,
    pauseSSID,
    mihomoCpuPriority = 'PRIORITY_NORMAL',
    autoLightweight = false,
    autoLightweightDelay = 60,
    autoLightweightMode = 'core',
    envType = [platform === 'win32' ? 'powershell' : 'bash'],
    networkDetection = false,
    networkDetectionBypass = ['VMware', 'vEthernet'],
    networkDetectionInterval = 10,
    extensionApiEnabled = false,
    extensionApiPort = 14123,
    extensionApiToken = '',
    extensionApiAllowedOrigins
  } = appConfig || {}

  const pauseSSIDArray = pauseSSID ?? emptyArray
  const allowedOriginsArray = extensionApiAllowedOrigins ?? emptyArray

  const [pauseSSIDInput, setPauseSSIDInput] = useState(pauseSSIDArray)
  const [allowedOriginsInput, setAllowedOriginsInput] = useState(allowedOriginsArray)
  const [extPortInput, setExtPortInput] = useState(extensionApiPort)

  const [bypass, setBypass] = useState(networkDetectionBypass)
  const [interval, setInterval] = useState(networkDetectionInterval)

  useEffect(() => {
    setPauseSSIDInput(pauseSSIDArray)
  }, [pauseSSIDArray])

  useEffect(() => {
    setAllowedOriginsInput(allowedOriginsArray)
  }, [allowedOriginsArray])

  useEffect(() => {
    setExtPortInput(extensionApiPort)
  }, [extensionApiPort])

  return (
    <SettingCard title="更多设置">
      <SettingItem
        title="自动开启轻量模式"
        actions={
          <Tooltip content="关闭窗口指定时间后自动进入轻量模式">
            <Button isIconOnly size="sm" variant="light">
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          isSelected={autoLightweight}
          onValueChange={(v) => {
            patchAppConfig({ autoLightweight: v })
          }}
        />
      </SettingItem>
      {autoLightweight && (
        <>
          <SettingItem title="轻量模式行为" divider>
            <Tabs
              size="sm"
              color="primary"
              selectedKey={autoLightweightMode}
              onSelectionChange={(v) => {
                patchAppConfig({ autoLightweightMode: v as 'core' | 'tray' })
                if (v === 'core') {
                  patchAppConfig({ autoLightweightDelay: Math.max(autoLightweightDelay, 5) })
                }
              }}
            >
              <Tab key="core" title="仅保留内核" />
              <Tab key="tray" title="仅关闭渲染进程" />
            </Tabs>
          </SettingItem>
          <SettingItem title="自动开启轻量模式延时" divider>
            <Input
              size="sm"
              className="w-[100px]"
              type="number"
              endContent="秒"
              value={autoLightweightDelay.toString()}
              onValueChange={async (v: string) => {
                let num = parseInt(v)
                if (isNaN(num)) num = 0
                const minDelay = autoLightweightMode === 'core' ? 5 : 0
                if (num < minDelay) num = minDelay
                await patchAppConfig({ autoLightweightDelay: num })
              }}
            />
          </SettingItem>
        </>
      )}
      <SettingItem
        title="复制环境变量类型"
        actions={envType.map((type) => (
          <Button
            key={type}
            title={type}
            isIconOnly
            size="sm"
            variant="light"
            onPress={() => copyEnv(type)}
          >
            <BiCopy className="text-lg" />
          </Button>
        ))}
        divider
      >
        <Select
          classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
          className="w-[150px]"
          size="sm"
          selectionMode="multiple"
          selectedKeys={new Set(envType)}
          disallowEmptySelection={true}
          onSelectionChange={async (v) => {
            try {
              await patchAppConfig({
                envType: Array.from(v) as ('bash' | 'fish' | 'cmd' | 'powershell' | 'nushell')[]
              })
            } catch (e) {
              alert(e)
            }
          }}
        >
          <SelectItem key="bash">Bash</SelectItem>
          <SelectItem key="fish">Fish</SelectItem>
          <SelectItem key="cmd">CMD</SelectItem>
          <SelectItem key="powershell">PowerShell</SelectItem>
          <SelectItem key="nushell">NuShell</SelectItem>
        </Select>
      </SettingItem>
      {platform === 'win32' && (
        <SettingItem title="内核进程优先级" divider>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-[150px]"
            size="sm"
            selectedKeys={new Set([mihomoCpuPriority])}
            disallowEmptySelection={true}
            onSelectionChange={async (v) => {
              try {
                await patchAppConfig({
                  mihomoCpuPriority: v.currentKey as Priority
                })
                await restartCore()
              } catch (e) {
                alert(e)
              }
            }}
          >
            <SelectItem key="PRIORITY_HIGHEST">实时</SelectItem>
            <SelectItem key="PRIORITY_HIGH">高</SelectItem>
            <SelectItem key="PRIORITY_ABOVE_NORMAL">高于正常</SelectItem>
            <SelectItem key="PRIORITY_NORMAL">正常</SelectItem>
            <SelectItem key="PRIORITY_BELOW_NORMAL">低于正常</SelectItem>
            <SelectItem key="PRIORITY_LOW">低</SelectItem>
          </Select>
        </SettingItem>
      )}
      <SettingItem title="接管 DNS 设置" divider>
        <Switch
          size="sm"
          isSelected={controlDns}
          onValueChange={async (v) => {
            try {
              await patchAppConfig({ controlDns: v })
              await patchControledMihomoConfig({})
              await restartCore()
            } catch (e) {
              alert(e)
            }
          }}
        />
      </SettingItem>
      <SettingItem title="接管域名嗅探设置" divider>
        <Switch
          size="sm"
          isSelected={controlSniff}
          onValueChange={async (v) => {
            try {
              await patchAppConfig({ controlSniff: v })
              await patchControledMihomoConfig({})
              await restartCore()
            } catch (e) {
              alert(e)
            }
          }}
        />
      </SettingItem>
      <SettingItem
        title="断网时停止内核"
        actions={
          <Tooltip content="开启后，应用会在检测到网络断开时自动停止内核，并在网络恢复后自动重启内核">
            <Button isIconOnly size="sm" variant="light">
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          isSelected={networkDetection}
          onValueChange={(v) => {
            patchAppConfig({ networkDetection: v })
            if (v) {
              startNetworkDetection()
            } else {
              stopNetworkDetection()
            }
          }}
        />
      </SettingItem>
      {networkDetection && (
        <>
          <SettingItem title="断网检测间隔" divider>
            <div className="flex">
              {interval !== networkDetectionInterval && (
                <Button
                  size="sm"
                  color="primary"
                  className="mr-2"
                  onPress={async () => {
                    await patchAppConfig({ networkDetectionInterval: interval })
                    await startNetworkDetection()
                  }}
                >
                  确认
                </Button>
              )}
              <Input
                size="sm"
                type="number"
                className="w-[100px]"
                endContent="秒"
                value={interval.toString()}
                min={1}
                onValueChange={(v) => {
                  setInterval(parseInt(v))
                }}
              />
            </div>
          </SettingItem>
          <SettingItem title="绕过检测的接口">
            {bypass.length != networkDetectionBypass.length && (
              <Button
                size="sm"
                color="primary"
                onPress={async () => {
                  await patchAppConfig({ networkDetectionBypass: bypass })
                  await startNetworkDetection()
                }}
              >
                确认
              </Button>
            )}
          </SettingItem>
          <EditableList items={bypass} onChange={(list) => setBypass(list as string[])} />
        </>
      )}
      <SettingItem title="在特定的 WiFi SSID 下直连">
        {pauseSSIDInput.join('') !== pauseSSIDArray.join('') && (
          <Button
            size="sm"
            color="primary"
            onPress={() => {
              patchAppConfig({ pauseSSID: pauseSSIDInput })
            }}
          >
            确认
          </Button>
        )}
      </SettingItem>
      <EditableList
        items={pauseSSIDInput}
        onChange={(list) => setPauseSSIDInput(list as string[])}
        divider={false}
      />

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
          onValueChange={async (v) => {
            try {
              await patchAppConfig({ extensionApiEnabled: v })
              await restartExtensionApiServer()
              mutateAppConfig()
            } catch (e) {
              alert(e)
            }
          }}
        />
      </SettingItem>

      {extensionApiEnabled && (
        <>
          <SettingItem title="扩展 API 端口" divider>
            <div className="flex">
              {extPortInput !== extensionApiPort && (
                <Button
                  size="sm"
                  color="primary"
                  className="mr-2"
                  onPress={async () => {
                    try {
                      const port = Math.min(65535, Math.max(1, extPortInput))
                      await patchAppConfig({ extensionApiPort: port })
                      await restartExtensionApiServer()
                      mutateAppConfig()
                    } catch (e) {
                      alert(e)
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
                value={extPortInput.toString()}
                min={1}
                max={65535}
                onValueChange={(v) => {
                  const n = parseInt(v)
                  setExtPortInput(Number.isFinite(n) ? n : 0)
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
                      await navigator.clipboard.writeText(extensionApiToken || '')
                    } catch (e) {
                      alert(e)
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
                    } catch (e) {
                      alert(e)
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
              type="password"
              value={extensionApiToken || ''}
              isReadOnly
            />
          </SettingItem>

          <SettingItem
            title="允许的 Origin"
            actions={
              <Tooltip content="留空表示不做 Origin 白名单校验；建议填 chrome-extension://<你的扩展ID>">
                <Button isIconOnly size="sm" variant="light">
                  <IoIosHelpCircle className="text-lg" />
                </Button>
              </Tooltip>
            }
          >
            {!isSameStringList(allowedOriginsInput, allowedOriginsArray) && (
              <Button
                size="sm"
                color="primary"
                onPress={async () => {
                  try {
                    await patchAppConfig({ extensionApiAllowedOrigins: allowedOriginsInput })
                    await restartExtensionApiServer()
                    mutateAppConfig()
                  } catch (e) {
                    alert(e)
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

export default AdvancedSettings
