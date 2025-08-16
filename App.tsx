import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State, Characteristic } from 'react-native-ble-plx';

// Initialize Bluetooth manager
const bleManager = new BleManager();

interface SensorData {
  temperature?: number;
  humidity?: number;
}

export default function App() {
  const [sensorData, setSensorData] = useState<SensorData>({});
  const [connected, setConnected] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Bluetooth not ready');
  const [bluetoothState, setBluetoothState] = useState<State>('Unknown');
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  useEffect(() => {
    // Check Bluetooth state
    const subscription = bleManager.onStateChange((state) => {
      setBluetoothState(state);
      if (state === 'PoweredOn') {
        setStatusMsg('Bluetooth is ready - Scan for devices');
      } else if (state === 'PoweredOff') {
        setStatusMsg('Bluetooth is turned off');
        setConnected(false);
        setSelectedDevice(null);
      } else if (state === 'Unauthorized') {
        setStatusMsg('Bluetooth permission denied');
      } else if (state === 'Unsupported') {
        setStatusMsg('Bluetooth not supported on this device');
      }
    }, true);

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    checkPermissions().then(setPermissionsGranted);
  }, []);

  // Request Bluetooth permissions
  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        // Request multiple permissions
        const permissions = [
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ];

        // Add Android 12+ permissions if available
        if (Platform.Version >= 31) {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
          );
        }

        const granted = await PermissionsAndroid.requestMultiple(permissions);
        
        // Check if all permissions were granted
        const allGranted = Object.values(granted).every(
          permission => permission === PermissionsAndroid.RESULTS.GRANTED
        );

        if (allGranted) {
          return true;
        } else {
          // Show which permissions were denied
          const deniedPermissions = Object.entries(granted)
            .filter(([_, status]) => status !== PermissionsAndroid.RESULTS.GRANTED)
            .map(([permission]) => permission);

          Alert.alert(
            'Permissions Required', 
            `The following permissions are required for Bluetooth scanning:\n${deniedPermissions.join('\n')}\n\nPlease grant these permissions in Settings.`
          );
          return false;
        }
      } catch (err) {
        console.warn('Permission request error:', err);
        Alert.alert('Error', 'Failed to request permissions');
        return false;
      }
    }
    return true;
  };

  // Check if permissions are already granted
  const checkPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const fineLocation = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        
        const coarseLocation = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION
        );
        
        let bluetoothScan = true;
        let bluetoothConnect = true;
        
        if (Platform.Version >= 31) {
          bluetoothScan = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
          );
          bluetoothConnect = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
          );
        }
        
        return fineLocation && coarseLocation && bluetoothScan && bluetoothConnect;
      } catch (err) {
        console.warn('Permission check error:', err);
        return false;
      }
    }
    return true;
  };

  // Start Bluetooth scan
  const startBLEScan = async () => {
    if (bluetoothState !== 'PoweredOn') {
      Alert.alert('Bluetooth Error', 'Please turn on Bluetooth');
      return;
    }

    // Check if permissions are already granted
    const hasPermissions = await checkPermissions();
    if (!hasPermissions) {
      // Request permissions if not granted
      const granted = await requestPermissions();
      if (!granted) {
        setStatusMsg('Bluetooth permissions required');
        return;
      }
    }

    setScanning(true);
    setStatusMsg('Scanning for BLE devices...');
    setDevices([]);

    try {
      bleManager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          console.error('Scan error:', error);
          setStatusMsg('Scan error: ' + error.message);
          setScanning(false);
          return;
        }

        if (device && device.name) {
          setDevices(prevDevices => {
            const exists = prevDevices.find(d => d.id === device.id);
            if (!exists) {
              return [...prevDevices, device];
            }
            return prevDevices;
          });
        }
      });

      // Stop scan after 10 seconds
      setTimeout(() => {
        bleManager.stopDeviceScan();
        setScanning(false);
        setStatusMsg(`Scan completed. Found ${devices.length} devices`);
      }, 10000);

    } catch (error) {
      console.error('Scan failed:', error);
      setStatusMsg('Scan failed: ' + error.message);
      setScanning(false);
    }
  };

  // Connect to selected device
  const connectToDevice = async (device: Device) => {
    try {
      setStatusMsg('Connecting to ' + device.name + '...');
      
      const connectedDevice = await device.connect();
      const discoveredDevice = await connectedDevice.discoverAllServicesAndCharacteristics();
      
      setSelectedDevice(discoveredDevice);
      setConnected(true);
      setStatusMsg('Connected to ' + device.name + ' - Discovering services...');
      
      // Discover services and characteristics
      const services = await discoveredDevice.services();
      
      // Look for the service that contains sensor data
      // You'll need to know your ESP32's service UUID
      for (const service of services) {
        const characteristics = await service.characteristics();
        
        // Look for characteristics that can notify (send data)
        for (const characteristic of characteristics) {
          if (characteristic.isNotifiable) {
            // Subscribe to notifications
            await characteristic.monitor((error, characteristic) => {
              if (error) {
                console.error('Notification error:', error);
                return;
              }
              
              if (characteristic && characteristic.value) {
                // Parse the data from your ESP32
                // This depends on how your ESP32 formats the data
                try {
                  const data = JSON.parse(characteristic.value);
                  if (data.temperature || data.humidity) {
                    setSensorData(data);
                    setStatusMsg('Receiving sensor data...');
                  }
                } catch (e) {
                  // Handle raw data if not JSON
                  console.log('Raw data received:', characteristic.value);
                }
              }
            });
          }
        }
      }
      
      setStatusMsg('Connected and monitoring ' + device.name);
      
    } catch (error) {
      console.error('Connection failed:', error);
      setStatusMsg('Connection failed: ' + error.message);
      setConnected(false);
    }
  };

  // Disconnect from device
  const disconnectDevice = async () => {
    if (selectedDevice) {
      try {
        await selectedDevice.cancelConnection();
        setSelectedDevice(null);
        setConnected(false);
        setSensorData({});
        setStatusMsg('Disconnected from device');
      } catch (error) {
        console.error('Disconnect failed:', error);
      }
    }
  };

  // Read sensor data manually (if needed)
  const readSensorData = async () => {
    if (!selectedDevice) return;
    
    try {
      setStatusMsg('Reading sensor data...');
      
      // You'll need to know your ESP32's service and characteristic UUIDs
      // This is just an example - replace with your actual UUIDs
      const service = await selectedDevice.services();
      // const characteristic = await service[0].characteristics();
      // const data = await characteristic[0].read();
      
      setStatusMsg('Data read successfully');
    } catch (error) {
      console.error('Read failed:', error);
      setStatusMsg('Failed to read data');
    }
  };

  const getStatusIndicator = (state: string, isConnected: boolean = false) => {
    if (isConnected) return '#2E7D32';
    if (state === 'PoweredOn') return '#1976D2';
    return '#D32F2F';
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>PIXEY DUST</Text>
        <Text style={styles.subtitle}>ESP32 Sensor Monitor</Text>
      </View>

      {/* Status Bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusItem}>
          <View style={[styles.indicator, { backgroundColor: getStatusIndicator(bluetoothState) }]} />
          <Text style={styles.statusLabel}>Bluetooth</Text>
          <Text style={styles.statusValue}>{bluetoothState}</Text>
        </View>
        
        <View style={styles.divider} />
        
        <View style={styles.statusItem}>
          <View style={[styles.indicator, { backgroundColor: connected ? '#2E7D32' : '#757575' }]} />
          <Text style={styles.statusLabel}>Connection</Text>
          <Text style={styles.statusValue}>{connected ? 'Connected' : 'Disconnected'}</Text>
        </View>
      </View>

      {/* Main Content */}
      <View style={styles.mainContent}>
        {/* Scan Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Device Discovery</Text>
          
          <TouchableOpacity 
            style={[
              styles.primaryButton, 
              (scanning || bluetoothState !== 'PoweredOn') && styles.disabledButton
            ]}
            onPress={startBLEScan}
            disabled={scanning || bluetoothState !== 'PoweredOn'}
          >
            <Text style={[
              styles.primaryButtonText,
              (scanning || bluetoothState !== 'PoweredOn') && styles.disabledButtonText
            ]}>
              {scanning ? 'Scanning...' : 'Scan for Devices'}
            </Text>
          </TouchableOpacity>

          {devices.length > 0 && (
            <View style={styles.devicesList}>
              <Text style={styles.devicesTitle}>Available Devices</Text>
              {devices.map((device) => (
                <View key={device.id} style={styles.deviceCard}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{device.name || 'Unknown Device'}</Text>
                    <Text style={styles.deviceId}>{device.id.substring(0, 18)}...</Text>
                  </View>
                  <TouchableOpacity 
                    style={[styles.secondaryButton, connected && styles.disabledButton]}
                    onPress={() => connectToDevice(device)}
                    disabled={connected}
                  >
                    <Text style={[styles.secondaryButtonText, connected && styles.disabledButtonText]}>
                      Connect
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Status Message */}
        <View style={styles.statusMessage}>
          <Text style={styles.statusText}>{statusMsg}</Text>
        </View>

        {/* Connected Device Controls */}
        {connected && selectedDevice && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Device Control</Text>
            <View style={styles.connectedDevice}>
              <Text style={styles.connectedDeviceName}>{selectedDevice.name}</Text>
              <View style={styles.controlButtons}>
                <TouchableOpacity style={styles.controlButton} onPress={readSensorData}>
                  <Text style={styles.controlButtonText}>Read Data</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.controlButton, styles.disconnectButton]} onPress={disconnectDevice}>
                  <Text style={[styles.controlButtonText, styles.disconnectButtonText]}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Sensor Data */}
        {connected && (sensorData.temperature !== undefined || sensorData.humidity !== undefined) && (
          <View style={styles.sensorSection}>
            <Text style={styles.sectionTitle}>Sensor Readings</Text>
            <View style={styles.sensorGrid}>
              {sensorData.temperature !== undefined && (
                <View style={styles.sensorCard}>
                  <Text style={styles.sensorLabel}>Temperature</Text>
                  <Text style={styles.sensorValue}>{sensorData.temperature}°</Text>
                  <Text style={styles.sensorUnit}>Celsius</Text>
                </View>
              )}
              
              {sensorData.humidity !== undefined && (
                <View style={styles.sensorCard}>
                  <Text style={styles.sensorLabel}>Humidity</Text>
                  <Text style={styles.sensorValue}>{sensorData.humidity}%</Text>
                  <Text style={styles.sensorUnit}>Relative</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  contentContainer: {
    flexGrow: 1,
    paddingBottom: 30,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 30,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#212529',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#6C757D',
    textAlign: 'center',
    marginTop: 8,
    fontWeight: '400',
  },
  statusBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  statusItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusLabel: {
    fontSize: 14,
    color: '#6C757D',
    marginRight: 8,
    fontWeight: '500',
  },
  statusValue: {
    fontSize: 14,
    color: '#212529',
    fontWeight: '600',
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: '#E9ECEF',
    marginHorizontal: 16,
  },
  mainContent: {
    padding: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#212529',
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: '#007BFF',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#E9ECEF',
  },
  disabledButtonText: {
    color: '#6C757D',
  },
  devicesList: {
    marginTop: 20,
  },
  devicesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 12,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    marginBottom: 8,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212529',
  },
  deviceId: {
    fontSize: 12,
    color: '#6C757D',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  secondaryButton: {
    backgroundColor: '#28A745',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  statusMessage: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#007BFF',
  },
  statusText: {
    fontSize: 14,
    color: '#495057',
    fontWeight: '500',
  },
  connectedDevice: {
    alignItems: 'center',
  },
  connectedDeviceName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#28A745',
    marginBottom: 16,
  },
  controlButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  controlButton: {
    backgroundColor: '#6C757D',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
  },
  controlButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  disconnectButton: {
    backgroundColor: '#DC3545',
  },
  disconnectButtonText: {
    color: '#FFFFFF',
  },
  sensorSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#212529',
    marginBottom: 16,
  },
  sensorGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  sensorCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  sensorLabel: {
    fontSize: 14,
    color: '#6C757D',
    fontWeight: '500',
    marginBottom: 8,
  },
  sensorValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#007BFF',
    marginBottom: 4,
  },
  sensorUnit: {
    fontSize: 12,
    color: '#6C757D',
    fontWeight: '500',
  },
});