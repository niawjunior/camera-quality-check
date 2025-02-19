import { CommonModule } from '@angular/common';
import {
  Component,
  HostListener,
  OnInit,
  ViewChild,
  ElementRef,
} from '@angular/core';

interface DeviceOrientationEventiOS extends DeviceOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: true,
  imports: [CommonModule],
})
export class AppComponent implements OnInit {
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef;
  @ViewChild('canvas', { static: false })
  canvas!: ElementRef<HTMLCanvasElement>;
  motionTimeout: any = 0;
  motionAndOrientationInfo: any = {};
  is_running = false;
  motionThreshold = 0.6; // Define your threshold for motion here
  isDeviceMoving = false;
  cameraStream!: MediaStream;
  brightnessCheckInterval: any;
  isDark = false;
  isBlurred = false;
  photoMessage: string = ''; // Message to display status
  photoTimeout: any = null; // Timeout for the 2-second photo process
  isTakingPhoto = false;
  photoData: any = null;
  isPopupOpen = false;
  constructor() {}

  ngOnInit() {}

  async init() {
    await this.startCamera();
  }

  startBrightnessCheck() {
    this.brightnessCheckInterval = setInterval(() => {
      this.checkBrightness();
      // Only check for blur if the image is not dark
      if (!this.isDark) {
        this.isBlurred = this.checkBlur() ?? false;
      } else {
        this.isBlurred = false; // Do not mark as blurred if it's dark
      }
    }, 500);
  }

  stopBrightnessCheck() {
    if (this.brightnessCheckInterval) {
      clearInterval(this.brightnessCheckInterval);
    }
  }

  checkBrightness() {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvas.nativeElement;
    const context = canvas.getContext('2d');

    // Set canvas dimensions to match the video feed dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the current frame from the video onto the canvas
    context?.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Extract pixel data from the canvas
    const frame = context?.getImageData(0, 0, canvas.width, canvas.height);
    if (!frame) return; // Exit if no frame data is available

    const pixelData = frame.data; // RGBA data for each pixel
    let darkPixelCount = 0; // Count of pixels classified as "dark"
    let totalPixelCount = pixelData.length / 4; // Total pixel count (4 values per pixel in RGBA)

    // Parameters for darkness detection
    const darkThreshold = 90; // Brightness level below which a pixel is considered "dark"

    const darknessProportionThreshold = 0.08; // Proportion of dark pixels needed to classify the image as "dark"
    //  with this, if 8% of pixels are classified as dark, it will trigger the "dark" condition.
    // Loop through pixels, sampling every 8th pixel for performance (i += 32)
    for (let i = 0; i < pixelData.length; i += 32) {
      const r = pixelData[i]; // Red channel
      const g = pixelData[i + 1]; // Green channel
      const b = pixelData[i + 2]; // Blue channel

      // Calculate brightness as the average of RGB values
      const brightness = (r + g + b) / 3;

      // If brightness is below the threshold, count this pixel as "dark"
      if (brightness < darkThreshold) {
        darkPixelCount++;
      }
    }

    // Calculate the proportion of dark pixels
    const darkProportion = darkPixelCount / totalPixelCount;

    // Determine if the image is "dark" based on the proportion of dark pixels
    this.isDark = darkProportion > darknessProportionThreshold;

    // Debugging logs to display intermediate values and results
    console.log('Dark Pixel Count:', darkPixelCount);
    console.log('Total Pixel Count:', totalPixelCount);
    console.log('Dark Proportion:', darkProportion);
    console.log('Is Dark:', this.isDark);
  }

  async initializeCameraAndMotion() {
    await this.requestMotionPermission();
    await this.requestCameraPermission();
    this.init();
  }

  async requestMotionPermission() {
    const requestPermission = (
      DeviceOrientationEvent as unknown as DeviceOrientationEventiOS
    ).requestPermission;
    const iOS = typeof requestPermission === 'function';
    if (iOS) {
      try {
        await requestPermission();
      } catch (error) {
        console.error('Error requesting motion permission:', error);
        alert('Error requesting motion permission.');
      }
    } else {
      console.log('Motion permission not supported on this device.');
      alert('Motion permission not supported on this device.');
    }
  }

  async requestCameraPermission() {
    try {
      // Use the Permissions API to check the camera permission status
      const permissionStatus = await (navigator.permissions as any).query({
        name: 'camera',
      });

      if (permissionStatus.state === 'granted') {
        console.log('Camera permission already granted.');
        return true;
      } else if (permissionStatus.state === 'prompt') {
        console.log('Camera permission needs to be requested.');
        // The browser will automatically request permission when getUserMedia is called.
        return true;
      } else {
        console.error('Camera permission denied.');
        alert(
          'Camera permission is denied. Please allow access to the camera in your browser settings.'
        );
        return false;
      }
    } catch (error) {
      console.error('Error checking camera permission:', error);
      alert('Error checking camera permission.');
      return false;
    }
  }

  async startCamera() {
    try {
      console.log('Requesting camera access...');
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: 'environment' },
          frameRate: {
            ideal: 30,
            max: 30,
          },
          width: {
            min: 1440,
            ideal: 1440,
            max: 1440,
          },
          height: {
            min: 1920,
            ideal: 1920,
            max: 1920,
          },
        },
      });
      console.log('Camera access granted.');
      this.videoElement.nativeElement.srcObject = this.cameraStream;
      this.videoElement.nativeElement.play();
      this.is_running = true;
      this.startBrightnessCheck();
    } catch (error) {
      alert('Error accessing camera.');
      console.error('Error accessing camera:', error);
    }
  }
  stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((track) => track.stop());
    }
  }

  @HostListener('window:devicemotion', ['$event'])
  handleMotion(event: any) {
    // Check if motion detection is active and if accelerometer data is available
    if (
      this.is_running && // Ensure that motion detection is enabled
      event.acceleration && // Check if acceleration data is available
      event.accelerationIncludingGravity // Check if acceleration including gravity is available
    ) {
      // Destructure the x, y, and z acceleration values from the event
      const { x, y, z } = event.acceleration;

      // Calculate the overall magnitude of motion (intensity of movement) using Pythagorean theorem
      const motionMagnitude = Math.sqrt(x ** 2 + y ** 2 + z ** 2);

      // Determine if the device is moving based on the calculated motion magnitude
      const isCurrentlyMoving = motionMagnitude > this.motionThreshold;

      // Debounce logic: Change `isDeviceMoving` status only if the motion state persists for 1 second
      if (isCurrentlyMoving) {
        // If moving, set `isDeviceMoving` to true immediately
        this.isDeviceMoving = true;
        this.clearMotionTimeout(); // Clear any existing timeout
      } else if (!this.motionTimeout) {
        // If not moving, start a timeout to delay status change to `false`
        this.motionTimeout = setTimeout(() => {
          this.isDeviceMoving = false;
          this.clearMotionTimeout();
        }, 500); // 0.5-second delay
      }

      // Store detailed motion and orientation information for further use or debugging
      this.motionAndOrientationInfo = {
        // Acceleration including gravity (acceleration affected by Earth's gravity)
        Accelerometer_gx: event.accelerationIncludingGravity.x.toFixed(10),
        Accelerometer_gy: event.accelerationIncludingGravity.y.toFixed(10),
        Accelerometer_gz: event.accelerationIncludingGravity.z.toFixed(10),

        // Raw acceleration (without gravity influence)
        Accelerometer_x: x.toFixed(10),
        Accelerometer_y: y.toFixed(10),
        Accelerometer_z: z.toFixed(10),

        // Interval between motion events, useful for tracking frequency
        Accelerometer_i: event.interval.toFixed(2),

        // Gyroscope data representing rotation rates along three axes
        // (rotation rate may be null on some devices, hence the optional chaining)
        Gyroscope_z: event.rotationRate?.alpha.toFixed(10), // Rotation around z-axis
        Gyroscope_x: event.rotationRate?.beta.toFixed(10), // Rotation around x-axis
        Gyroscope_y: event.rotationRate?.gamma.toFixed(10), // Rotation around y-axis
      };

      // Increment the event count, which can be used to track the number of motion events processed
      this.incrementEventCount();
    }
  }

  @HostListener('window:deviceorientation', ['$event'])
  handleOrientation(event: DeviceOrientationEvent) {
    if (this.is_running) {
      this.motionAndOrientationInfo = {
        ...this.motionAndOrientationInfo,
        Orientation_a: event.alpha?.toFixed(10),
        Orientation_b: event.beta?.toFixed(10),
        Orientation_g: event.gamma?.toFixed(10),
      };

      this.incrementEventCount();
    }
  }

  incrementEventCount() {
    // Use this function to increment any event count or update your component state
  }

  get motionWarning() {
    return this.isDeviceMoving
      ? 'Please hold the device steady while taking the photo.'
      : '';
  }

  ngOnDestroy() {
    this.stopCamera();
    this.stopBrightnessCheck();
  }

  checkBlur() {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvas.nativeElement;
    const context = canvas.getContext('2d');

    // Set canvas dimensions to match video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the current video frame onto the canvas
    context?.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get the pixel data from the canvas
    const frame = context?.getImageData(0, 0, canvas.width, canvas.height);
    if (!frame) return;

    const pixelData = frame.data;
    const grayscaleData = [];

    // Convert the image to grayscale
    for (let i = 0; i < pixelData.length; i += 4) {
      const r = pixelData[i]; // Red channel
      const g = pixelData[i + 1]; // Green channel
      const b = pixelData[i + 2]; // Blue channel

      // Purpose: Simplifies the image data by converting it from color (RGB) to grayscale.

      // The red, green, and blue channels are combined using a weighted formula (0.2989 * R + 0.587 * G + 0.114 * B), which mimics human perception of brightness.
      // Calculate grayscale value
      const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
      grayscaleData.push(gray);
    }

    // Apply a simple Laplacian filter for edge detection
    // Purpose: Detects edges in the image by applying a Laplacian operator, which highlights areas of rapid intensity change (edges).

    // How it works:
    // Each pixel is compared to its neighbors (left, right, top, and bottom).
    // The Laplacian operator computes a value based on the difference in intensity between the pixel and its neighbors.
    // The result (laplacianValue) captures the edge intensity at each pixel.

    const laplacianResult = [];
    const width = canvas.width;
    const height = canvas.height;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;

        // Approximation of Laplacian operator
        const laplacianValue =
          -4 * grayscaleData[i] +
          grayscaleData[i - 1] + // Left pixel
          grayscaleData[i + 1] + // Right pixel
          grayscaleData[i - width] + // Top pixel
          grayscaleData[i + width]; // Bottom pixel

        laplacianResult.push(Math.abs(laplacianValue));
      }
    }

    // Purpose: Measures how spread out the edge intensities are.

    // * Mean: The average value of the Laplacian edge intensities.

    // Variance: Measures the variability of the Laplacian values around the mean.
    // A high variance indicates distinct edges (sharp image).
    // A low variance indicates few or weak edges (blurry image).

    // Calculate the variance of the Laplacian values
    const mean =
      laplacianResult.reduce((a, b) => a + b, 0) / laplacianResult.length;
    const variance =
      laplacianResult.reduce((a, b) => a + (b - mean) ** 2, 0) /
      laplacianResult.length;

    // Threshold for blur detection (tune this based on testing)
    const blurThreshold = 30; // Higher = more sensitive to blur

    // If the variance is below the threshold, the image is classified as blurry (isBlurred = true).
    // If the variance is above the threshold, the image is classified as sharp (isBlurred = false).
    const isBlurred = variance < blurThreshold;

    // Debugging logs
    console.log('Variance of Laplacian:', variance);
    console.log('Is Blurred:', isBlurred);

    return isBlurred;
  }

  clearMotionTimeout() {
    if (this.motionTimeout) {
      clearTimeout(this.motionTimeout);
      this.motionTimeout = null;
    }
  }

  takePhoto() {
    // Reset the photo process
    this.isTakingPhoto = true;
    this.clearPhotoTimeout();

    const startTime = Date.now(); // Record the start time
    let isPhotoTaken = false; // Flag to indicate if a photo was successfully taken

    // Start checking conditions for 2 seconds
    this.photoTimeout = setInterval(() => {
      // Check all conditions: not moving, not dark, not blurred
      if (!this.isDeviceMoving && !this.isDark && !this.isBlurred) {
        if (!isPhotoTaken) {
          // Conditions are met; take the photo
          this.snapPhoto();
          isPhotoTaken = true;
          this.isTakingPhoto = false;
          this.photoMessage = 'Photo captured successfully!';
          this.clearPhotoTimeout(); // Clear the interval
        }
      }

      // If 2 seconds have elapsed and no valid frame was captured
      if (Date.now() - startTime > 2000 && !isPhotoTaken) {
        this.photoMessage =
          'Unable to capture photo. Please ensure the device is steady, the scene is bright, and the image is clear.';
        this.clearPhotoTimeout();
        this.isTakingPhoto = false;
      }
    }, 100); // Check conditions every 100ms
  }

  snapPhoto() {
    const canvas = this.canvas.nativeElement;
    const video = this.videoElement.nativeElement;
    const context = canvas.getContext('2d');

    // Set canvas dimensions to match video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the current frame onto the canvas
    context?.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Optionally, get the photo data as a Base64 image
    this.photoData = canvas.toDataURL('image/png');

    // You can save the photoData or use it as needed
    console.log('Photo captured:', this.photoData);
    this.isPopupOpen = true;
  }

  clearPhotoTimeout() {
    if (this.photoTimeout) {
      clearInterval(this.photoTimeout);
      this.photoTimeout = null;
    }
  }

  closePhoto() {
    this.photoData = null; // Clear photo to close overlay
    this.isPopupOpen = false;
  }

  get isValid() {
    return (
      this.isDeviceMoving === false &&
      this.isDark === false &&
      this.isBlurred === false
    );
  }
}
