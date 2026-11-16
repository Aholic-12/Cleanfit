/*
 * Cleanfit · 双激光对射测宽（ESP32-S3 + 2× VL53L1X）
 * ------------------------------------------------------------
 * 原理：W = B − dL − dR
 *   B  = 两个激光出光口之间的基线（mm，用卡尺量）
 *   dL = 左侧激光到人体左表面的距离（mm）
 *   dR = 右侧激光到人体右表面的距离（mm）
 *
 * 接线（按你的板子改 PIN_*）：
 *   VL53L1X L : VIN→3V3  GND→GND  SDA→GPIO8  SCL→GPIO9  XSHUT→GPIO4
 *   VL53L1X R : VIN→3V3  GND→GND  SDA→GPIO8  SCL→GPIO9  XSHUT→GPIO5
 *   注意：一定要用「带电平转换」的 VL53L1X 模块（裸芯片是 2.8V 逻辑）。
 *
 * 输出（USB 串口 115200，每行一个 JSON）：
 *   {"t":1234,"dL":247,"dR":243,"B":500,"ok":1}
 * 若填了 Wi-Fi，同一份 JSON 会通过 WebSocket 广播到 ws://<ip>:81
 *
 * 依赖库（Arduino 库管理器安装）：
 *   - Adafruit VL53L1X
 *   - WebSockets（作者 Markus Sattler / Links2004）   ← 仅 Wi-Fi 模式需要
 *
 * 关键点：
 *   1) 两个 VL53L1X 出厂地址都是 0x29，必须用 XSHUT 分时上电后改地址。
 *   2) 两台传感器「轮流」测距（不是同时），避免互相串扰。
 *   3) 每次只做单次测量再停，保证不会同时发光。
 */

#include <Wire.h>
#include <Adafruit_VL53L1X.h>

// ---------------- 配置 ----------------
#define PIN_SDA    8
#define PIN_SCL    9
#define XSHUT_L    4
#define XSHUT_R    5

#define BASELINE_MM   500      // 两束激光出光口的基线，卡尺实测后改这里
#define ADDR_L        0x30
#define ADDR_R        0x31
#define READ_INTERVAL 40       // 每轮间隔 ms（两台各 ~20ms，约 20–25 Hz）
#define RANGE_TIMEOUT 120      // 单次测距超时 ms

// 想用 Wi-Fi 就填这里；留空则只走 USB 串口
static const char* WIFI_SSID = "";
static const char* WIFI_PASS = "";

#if __has_include(<WiFi.h>) && __has_include(<WebSocketsServer.h>)
  #include <WiFi.h>
  #include <WebSocketsServer.h>
  #define USE_WIFI 1
#endif

Adafruit_VL53L1X vlL;
Adafruit_VL53L1X vlR;
bool okL = false, okR = false;

#ifdef USE_WIFI
WebSocketsServer ws(81);
#endif

// ---------------- 传感器初始化 ----------------
bool initOne(Adafruit_VL53L1X &s, uint8_t newAddr) {
  if (!s.begin(0x29, &Wire)) return false;
  if (!s.setI2CAddress(newAddr)) return false;
  s.setDistanceMode(VL53L1X::Short);   // 0.2–1.3m 内最准
  s.setTimingBudget(20);               // 20ms 积分
  return true;
}

void initSensors() {
  pinMode(XSHUT_L, OUTPUT);
  pinMode(XSHUT_R, OUTPUT);
  digitalWrite(XSHUT_L, LOW);
  digitalWrite(XSHUT_R, LOW);
  delay(30);

  // 先放 L，改到 0x30
  digitalWrite(XSHUT_L, HIGH);
  delay(40);
  okL = initOne(vlL, ADDR_L);
  Serial.printf("# sensor L: %s\n", okL ? "ok" : "FAIL");

  // 再放 R，改到 0x31
  digitalWrite(XSHUT_R, HIGH);
  delay(40);
  okR = initOne(vlR, ADDR_R);
  Serial.printf("# sensor R: %s\n", okR ? "ok" : "FAIL");
}

// ---------------- 单次测距（阻塞，带超时）----------------
int readOnce(Adafruit_VL53L1X &s) {
  s.startRanging();
  uint32_t t0 = millis();
  while (!s.dataReady()) {
    if (millis() - t0 > RANGE_TIMEOUT) { s.stopRanging(); return -1; }
    delay(1);
  }
  int d = s.readRange();
  s.stopRanging();
  return d;
}

// ---------------- 输出 ----------------
void emit(int dL, int dR) {
  char buf[128];
  int n = snprintf(buf, sizeof(buf),
                   "{\"t\":%lu,\"dL\":%d,\"dR\":%d,\"B\":%d,\"ok\":%d}\n",
                   (unsigned long)millis(), dL, dR, BASELINE_MM,
                   (dL > 0 && dR > 0) ? 1 : 0);
  Serial.print(buf);
#ifdef USE_WIFI
  if (WiFi.status() == WL_CONNECTED) ws.broadcastTXT((const uint8_t*)buf, n);
#endif
}

// ---------------- setup / loop ----------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("# Cleanfit laser gate booting");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  initSensors();

#ifdef USE_WIFI
  if (strlen(WIFI_SSID)) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.print("# wifi connecting");
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
      delay(300);
      Serial.print(".");
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("# ws://");
      Serial.print(WiFi.localIP());
      Serial.println(":81");
      ws.begin();
      ws.onEvent([](uint8_t num, WStype_t type, uint8_t*, size_t) {
        if (type == WStype_CONNECTED) {
          Serial.printf("# client %u connected\n", num);
        }
      });
    } else {
      Serial.println("# wifi failed, serial only");
    }
  }
#endif
}

void loop() {
#ifdef USE_WIFI
  if (WiFi.status() == WL_CONNECTED) ws.loop();
#endif

  static uint32_t last = 0;
  if (millis() - last < READ_INTERVAL) return;
  last = millis();

  // 轮流测：先 L 后 R，避免同时发光互相干扰
  int dL = okL ? readOnce(vlL) : -1;
  int dR = okR ? readOnce(vlR) : -1;
  emit(dL, dR);
}
