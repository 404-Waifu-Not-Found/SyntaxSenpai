import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  StyleSheet,
  Dimensions,
} from "react-native";
import { CameraView, Camera } from "expo-camera";
import { useRouter } from "expo-router";
import { useTheme } from "../../src/hooks/useTheme";

const { width } = Dimensions.get("window");
const VIEWFINDER_SIZE = width * 0.65;

export default function ScanScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    Camera.requestCameraPermissionsAsync().then(({ status }) => {
      setHasPermission(status === "granted");
    });
  }, []);

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    try {
      const payload = JSON.parse(data);
      if (
        typeof payload.wsUrl !== "string" ||
        typeof payload.token !== "string"
      ) {
        throw new Error("Missing wsUrl or token");
      }
      router.replace({
        pathname: "/(main)/pair-confirm",
        params: { wsUrl: payload.wsUrl, token: payload.token },
      });
    } catch {
      Alert.alert(
        "Invalid QR Code",
        "Please scan a SyntaxSenpai desktop QR code.",
        [{ text: "OK", onPress: () => setTimeout(() => setScanned(false), 500) }]
      );
    }
  };

  if (hasPermission === null) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <Text style={[styles.statusText, { color: colors.fg }]}>Requesting camera permission...</Text>
      </SafeAreaView>
    );
  }

  if (hasPermission === false) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <Text style={[styles.statusText, { color: colors.fg }]}>Camera access denied.</Text>
        <Text style={[styles.subText, { color: colors.fg + "80" }]}>
          Enable camera access in Settings to scan QR codes.
        </Text>
        <TouchableOpacity
          style={[styles.backBtn, { borderColor: colors.primary }]}
          onPress={() => router.back()}
        >
          <Text style={[styles.backBtnText, { color: colors.primary }]}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: "#000" }]}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleBarcodeScanned}
      />

      {/* Dark overlay with viewfinder cutout */}
      <View style={styles.overlay}>
        {/* Top */}
        <View style={[styles.overlaySection, { backgroundColor: "rgba(0,0,0,0.6)" }]} />

        {/* Middle row */}
        <View style={styles.overlayMiddle}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
          {/* Viewfinder */}
          <View style={[styles.viewfinder, { width: VIEWFINDER_SIZE, height: VIEWFINDER_SIZE }]}>
            {/* Corner markers */}
            <View style={[styles.corner, styles.cornerTL, { borderColor: colors.primary }]} />
            <View style={[styles.corner, styles.cornerTR, { borderColor: colors.primary }]} />
            <View style={[styles.corner, styles.cornerBL, { borderColor: colors.primary }]} />
            <View style={[styles.corner, styles.cornerBR, { borderColor: colors.primary }]} />
          </View>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
        </View>

        {/* Bottom */}
        <View style={[styles.overlaySection, { backgroundColor: "rgba(0,0,0,0.6)", paddingTop: 32 }]}>
          <Text style={styles.instructionText}>
            Point your camera at the QR code{"\n"}shown in SyntaxSenpai on your computer
          </Text>
          <TouchableOpacity
            style={[styles.cancelBtn, { backgroundColor: "rgba(255,255,255,0.1)" }]}
            onPress={() => router.back()}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const CORNER_SIZE = 24;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  statusText: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginHorizontal: 32,
  },
  subText: {
    fontSize: 14,
    textAlign: "center",
    marginHorizontal: 32,
    marginTop: 8,
  },
  backBtn: {
    marginTop: 24,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "column",
  },
  overlaySection: {
    flex: 1,
    alignItems: "center",
  },
  overlayMiddle: {
    flexDirection: "row",
    height: VIEWFINDER_SIZE,
  },
  viewfinder: {
    position: "relative",
  },
  instructionText: {
    color: "#ffffff",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginHorizontal: 32,
    marginBottom: 24,
  },
  cancelBtn: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  cancelBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  corner: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderWidth: CORNER_WIDTH,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
});
