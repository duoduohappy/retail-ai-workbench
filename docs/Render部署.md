# 手动部署到Render

部署入口：

https://render.com/deploy?repo=https://github.com/duoduohappy/retail-ai-workbench

该链接使用仓库根目录的render.yaml。打开后登录自己的Render账号，检查创建的服务，再自行确认部署。项目不会替你创建服务，也没有设置自动发布。

## Blueprint方式

1. 打开上面的部署入口。
2. 确认仓库为duoduohappy/retail-ai-workbench、分支main。
3. 检查Blueprint解析出的服务：Python Web Service、服务名retail-ai-workbench、Free方案。
4. 按页面提示确认创建与部署。
5. 成功后，在服务页面复制Render实际生成的onrender.com访问地址。

具体域名由Render分配，仓库名称不保证对应同名域名。配置默认关闭自动部署，以后可在Render服务页面选择Manual Deploy部署最新代码。

## 手动创建Web Service时填写

| 设置 | 值 |
| --- | --- |
| Repository | https://github.com/duoduohappy/retail-ai-workbench |
| Branch | main |
| Root Directory | 留空 |
| Runtime | Python 3 |
| Build Command | python -m compileall -q server.py |
| Start Command | python server.py --host 0.0.0.0 --port $PORT |
| Health Check Path | /api/health |
| Auto-Deploy | Off |

服务只使用Python标准库。视频、AI素材、SQLite演示数据和前端文件均已随仓库提供，不需要部署时生成，也不需要安装Pillow、ffmpeg或Node。

## 部署后核对

- 首页显示六个模块。
- /api/health返回200及ok:true。modelConfigured:false表示尚未配置外部模型，不影响默认演示。
- 内容工厂中的15秒有声样片可播放。
- 可运行研究、促销与模拟实验，并能导出文件。

本次仅准备并测试了部署配置，未代为创建Render服务，未声称完成实际Render部署。默认不配置外部模型密钥，页面的统计、资料检索、模板脚本和内置AI素材可独立使用。

参考：[Render部署按钮](https://render.com/docs/deploy-to-render)、[Blueprint字段](https://render.com/docs/blueprint-spec)、[监听地址与端口](https://render.com/docs/troubleshooting-deploys)。
