// The 3D camera. It stays roll-free: all it stores is a position, yaw and pitch, and every control
// is a change to those.

import * as THREE from 'three';

const MAX_PITCH = Math.PI / 2 - 0.001;
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const scratch = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const before = new THREE.Quaternion();

export class CameraRig {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.position = this.camera.position;
    this.yaw = 0;
    this.pitch = 0;
    /** The point orbits turn around. Follows the surface under the cursor. */
    this.pivot = new THREE.Vector3();
    this.center = new THREE.Vector3();
    this.radius = 1;
    /** Fly speed in model radii per second. Scrolling during free-fly changes it. */
    this.flySpeed = 1.2;
    this.#apply();
  }

  #apply() {
    euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(euler);
    this.#updateClip();
    this.camera.updateMatrixWorld(true);
  }

  // Near and far follow the camera, which keeps depth precision good at any model scale and lets
  // the camera get very close to a surface without clipping through it.
  #updateClip() {
    const distance = this.position.distanceTo(this.center);
    this.camera.near = Math.max((distance - this.radius) * 0.5, this.radius * 0.0015);
    this.camera.far = Math.max(distance + this.radius * 6, this.camera.near * 2000);
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Fits a sphere in view from a pleasant three-quarter angle.
   * @param {THREE.Sphere} sphere
   * @param {boolean} [keepAngle] keep looking from the current direction
   */
  frame(sphere, keepAngle = false) {
    this.center.copy(sphere.center);
    this.radius = Math.max(sphere.radius, 1e-5);
    if (!keepAngle) {
      this.yaw = THREE.MathUtils.degToRad(30);
      this.pitch = THREE.MathUtils.degToRad(-15);
    }
    euler.set(this.pitch, this.yaw, 0);
    const back = scratch.set(0, 0, 1).applyEuler(euler);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fit = Math.min(tan, tan * this.camera.aspect);
    const distance = (this.radius / fit) * 1.15;
    this.position.copy(this.center).addScaledVector(back, distance);
    this.pivot.copy(this.center);
    this.#apply();
  }

  /** Turns around the pivot. dx and dy are in pixels. */
  orbit(dx, dy) {
    const speed = 0.005;
    before.copy(this.camera.quaternion).invert();
    const offset = scratch.copy(this.position).sub(this.pivot).applyQuaternion(before);
    this.yaw -= dx * speed;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * speed, -MAX_PITCH, MAX_PITCH);
    euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(euler);
    this.position.copy(this.pivot).add(offset.applyQuaternion(this.camera.quaternion));
    this.#apply();
  }

  /** Slides the view so the point at the pivot's depth follows the cursor. */
  pan(dx, dy, viewHeight) {
    const depth = Math.max(scratch.copy(this.pivot).sub(this.position).dot(this.#forward()), this.radius * 0.01);
    const worldPerPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / viewHeight;
    const right = scratch.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = scratchB.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.position.addScaledVector(right, -dx * worldPerPixel).addScaledVector(up, dy * worldPerPixel);
    this.pivot.addScaledVector(right, -dx * worldPerPixel).addScaledVector(up, dy * worldPerPixel);
    this.#apply();
  }

  #forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  /**
   * Moves toward a point by a share of the distance to it, so a scroll step feels the same at any
   * scale and the point under the cursor stays under the cursor.
   * @param {THREE.Vector3} target
   * @param {number} amount positive zooms in
   */
  zoomToward(target, amount) {
    const t = 1 - 0.85 ** amount;
    const offset = scratch.copy(target).sub(this.position);
    // Don't step through the surface when the point is already close.
    const move = Math.min(t, 0.9);
    this.position.addScaledVector(offset, move);
    this.#apply();
  }

  /**
   * Moves along the view direction for a drag-zoom gesture.
   * @param {number} amount positive zooms in
   */
  dolly(amount) {
    const depth = Math.max(scratch.copy(this.pivot).sub(this.position).length(), this.radius * 0.01);
    this.position.addScaledVector(this.#forward(), depth * (1 - 0.9 ** amount));
    this.#apply();
  }

  /** Mouse look, turning in place. */
  look(dx, dy) {
    const speed = 0.0025;
    this.yaw -= dx * speed;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * speed, -MAX_PITCH, MAX_PITCH);
    this.#apply();
  }

  /**
   * Free-fly movement.
   * @param {number} dt seconds
   * @param {{ x: number, y: number, z: number }} input x right, y up, z forward, each -1..1
   * @param {boolean} fast
   */
  fly(dt, input, fast) {
    const speed = this.flySpeed * this.radius * (fast ? 3 : 1) * dt;
    const forward = this.#forward();
    const right = scratch.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.position.addScaledVector(forward, input.z * speed).addScaledVector(right, input.x * speed);
    this.position.y += input.y * speed;
    this.#apply();
  }

  changeFlySpeed(steps) {
    this.flySpeed = THREE.MathUtils.clamp(this.flySpeed * 1.2 ** steps, 0.02, 40);
  }

  /** Sets where a point on a pointer's ray would sit if nothing was hit: at the pivot's depth. */
  pointAtPivotDepth(ray, out) {
    const forward = this.#forward();
    const depth = Math.max(scratch.copy(this.pivot).sub(ray.origin).dot(forward), this.radius * 0.02);
    const along = depth / Math.max(ray.direction.dot(forward), 0.05);
    return out.copy(ray.origin).addScaledVector(ray.direction, along);
  }

  /** @returns {object} state to save with a project */
  toJSON() {
    return {
      position: this.position.toArray(), yaw: this.yaw, pitch: this.pitch, pivot: this.pivot.toArray(),
    };
  }

  fromJSON(state) {
    if (!state?.position) return false;
    this.position.fromArray(state.position);
    this.pivot.fromArray(state.pivot);
    this.yaw = state.yaw;
    this.pitch = state.pitch;
    this.#apply();
    return true;
  }
}
