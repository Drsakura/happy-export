# 外贸供应链管理系统

一个专为外贸企业设计的供应链与客户管理系统。

## 功能模块

### 业务管理
- **工作台** - 数据汇总、日程提醒、节日显示
- **供应商价格管理** - 继承 SKU Manager 完整功能
- **产品管理** - SKU/SPU 两层管理、包装参数、阶梯价格
- **PI合同管理** - 合同解析、价格历史追踪

### 客户管理
- **客户管理** - 客户信息、联系人、跟进记录
- **新客开发** - 自动获客、AI 智能分析
- **商机管理** - 销售管道、成交预测
- **订单管理** - 订单跟踪、备注跟进

## 技术栈

### 后端
- Node.js + Express
- SQLite + better-sqlite3-multiple-ciphers
- 加密存储（SQLCipher）

### 前端
- React 18
- React Router
- Vite
- 原生 CSS

## 快速开始

### 安装依赖

```bash
# 后端
cd backend
npm install

# 前端
cd frontend
npm install
```

### 启动开发环境

```bash
# 启动后端服务器（终端1）
cd backend
npm start

# 启动前端开发服务器（终端2）
cd frontend
npm run dev
```

### 访问系统

- 前端开发地址: http://127.0.0.1:5300
- 后端 API 地址: http://127.0.0.1:4300

### 默认账号

- 用户名: `admin`
- 密码: `admin123`

**⚠️ 首次登录后请立即修改密码！**

## 项目结构

```
trade-management-system/
├── backend/              # 后端
│   ├── db/              # 数据库
│   │   ├── schema.sql   # 数据库结构
│   │   └── db.js        # 数据库连接
│   ├── lib/             # 工具库
│   ├── routes/          # API 路由
│   ├── data/            # 数据存储目录
│   ├── uploads/         # 上传文件
│   ├── server.js        # 服务器入口
│   └── package.json
├── frontend/            # 前端
│   ├── src/
│   │   ├── components/  # 组件
│   │   ├── pages/       # 页面
│   │   ├── services/    # API 服务
│   │   ├── styles/      # 样式
│   │   ├── App.jsx      # 主应用
│   │   └── main.jsx     # 入口文件
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── docs/                # 文档
└── README.md
```

## 数据库

使用 SQLite + SQLCipher 加密存储：
- 数据库文件: `backend/data/trade.db`
- 自动初始化表结构
- 支持备份和迁移

## 开发计划

### Phase 1：基础框架 ✅
- [x] 项目结构搭建
- [x] 数据库设计
- [x] 前后端基础框架
- [x] 工作台页面

### Phase 2：供应商与产品管理
- [ ] 迁移 SKU Manager 功能
- [ ] 阶梯价格管理
- [ ] 合同解析引擎
- [ ] 产品图片管理

### Phase 3：客户 CRM
- [ ] 客户详细页面
- [ ] 联系人管理
- [ ] 商机管道视图
- [ ] 跟进活动时间线

### Phase 4：订单管理
- [ ] 订单创建和编辑
- [ ] 订单状态流转
- [ ] 订单备注系统
- [ ] PDF 导出

### Phase 5：自动获客
- [ ] 集成 GoodJob 获客引擎
- [ ] 数据源适配
- [ ] AI 智能分析
- [ ] 线索转化

## 许可证

私有项目

## 作者

Wayne
