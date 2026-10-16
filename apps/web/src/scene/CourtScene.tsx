import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { type RefObject, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type Group, type Object3D, PMREMGenerator, Quaternion, Vector3 } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CHARACTER_IDS, type CharacterId, jointsOf, missingJoints, modelUrl } from "./characters.js";
import { CAMERA_RATE, dampVec, keepInside, toScreen, type Vec3 } from "./camera.js";
import { COURTROOM_URL, isSeated, missingAnchors, type Shot, shotNodes, SPOTS } from "./courtroom.js";
import type { Action, Direction } from "./direct.js";
import { approach, type Pose, pose } from "./poses.js";

/**
 * Sala rozpraw w 3D. Cala logika (kto co robi, gdzie kamera, poza w danej chwili) jest w czystych
 * modulach z testami; ten komponent tylko wczytuje modele i co klatke przenosi wynik na obiekty three.js.
 * Dla czytnikow ekranu scena jest ukryta — te same informacje sa w widoku 2D pod nia.
 */
export interface CourtSceneProps {
  readonly direction: Direction;
  readonly reducedMotion: boolean;
  /** WebGL bez karty graficznej: bez cieni i w rozdzielczosci 1x, zeby procesor nadazal. */
  readonly lowPower: boolean;
}

const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;

const VERDICT = { invite: "ZAPROSIĆ", reject: "ODRZUCIĆ" } as const;

export default function CourtScene({ direction, reducedMotion, lowPower }: CourtSceneProps) {
  const bubble = useRef<HTMLDivElement>(null);
  const { bubble: said, verdict } = direction;
  // Dymek to zwykly element DOM nad plotnem; co klatke przesuwamy go nad glowe mowcy.
  const placeBubble = useCallback((x: number, y: number, visible: boolean) => {
    const element = bubble.current;
    const stage = element?.parentElement;
    if (element == null || stage == null) return;
    const at = keepInside({ x, y }, { width: element.offsetWidth, height: element.offsetHeight }, { width: stage.clientWidth, height: stage.clientHeight });
    element.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;
    element.style.visibility = visible ? "visible" : "hidden";
  }, []);
  return (
    <div className="scene" data-shot={direction.shot} data-speaker={said?.who ?? ""} data-verdict={verdict ?? ""} aria-hidden="true">
      <Canvas
        shadows={lowPower ? false : "percentage"}
        flat
        dpr={lowPower ? 1 : [1, 2]}
        camera={{ fov: 50, near: 0.1, far: 80 }}
        scene={{ environmentIntensity: 0.35 }}
        frameloop={reducedMotion ? "demand" : "always"}
      >
        <Environment />
        <hemisphereLight args={["#fff6e8", "#6b4a2f", 0.35]} />
        <directionalLight position={[-6, 6, -4]} intensity={0.5} />
        <directionalLight
          position={[2, 12, 5]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
          shadow-bias={-0.0005}
        />
        <Suspense fallback={null}>
          <Court direction={direction} still={reducedMotion} placeBubble={placeBubble} />
        </Suspense>
      </Canvas>
      {said !== null && (
        <div ref={bubble} className={`scene__bubble scene__bubble--${said.who}`}>
          {said.text}
          {said.revisedScore !== null && <strong className="scene__revised"> → {said.revisedScore}/10</strong>}
        </div>
      )}
      {verdict !== null && <div className={`scene__verdict scene__verdict--${verdict}`}>{VERDICT[verdict]}</div>}
    </div>
  );
}

/** Otoczenie do odbic: bez niego metal (zloto wagi, zyrandole) wychodzi czarny. */
function Environment() {
  const gl = useThree((s) => s.gl);
  const texture = useMemo(() => {
    const pmrem = new PMREMGenerator(gl);
    const result = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return result;
  }, [gl]);
  useEffect(
    () => () => {
      texture.dispose();
    },
    [texture],
  );
  return <primitive object={texture} attach="environment" />;
}

type PlaceBubble = (x: number, y: number, visible: boolean) => void;

function Court({ direction, still, placeBubble }: { readonly direction: Direction; readonly still: boolean; readonly placeBubble: PlaceBubble }) {
  const room = useLoader(GLTFLoader, url(COURTROOM_URL));
  const models = useLoader(
    GLTFLoader,
    CHARACTER_IDS.map((id) => url(modelUrl(id))),
  );
  const invalidate = useThree((s) => s.invalidate);

  const anchors = useMemo(() => {
    const names: string[] = [];
    room.scene.traverse((o) => names.push(o.name));
    const missing = missingAnchors(names);
    if (missing.length > 0) throw new Error(`Sali brakuje punktow: ${missing.join(", ")}`);
    room.scene.updateMatrixWorld(true);
    return (name: string) => room.scene.getObjectByName(name) as Object3D;
  }, [room]);

  useEffect(() => {
    for (const gltf of [room, ...models]) {
      gltf.scene.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
    }
  }, [room, models]);

  // W trybie bez ruchu klatka rysuje sie tylko na zadanie — po kazdej zmianie rezyserii.
  useEffect(() => {
    invalidate();
  }, [direction, invalidate]);

  const heads = useRef(new Map<CharacterId, Object3D>());

  return (
    <>
      <primitive object={room.scene} />
      {CHARACTER_IDS.map((id, i) => (
        <Character
          key={id}
          id={id}
          gltf={models[i] as GLTF}
          spot={anchors(SPOTS[id])}
          action={direction.actions[id]}
          still={still}
          heads={heads}
        />
      ))}
      <CameraRig shot={direction.shot} anchor={anchors} still={still} />
      <BubbleTracker who={direction.bubble?.who ?? null} heads={heads} place={placeBubble} />
    </>
  );
}

interface CharacterProps {
  readonly id: CharacterId;
  readonly gltf: GLTF;
  readonly spot: Object3D;
  readonly action: Action;
  readonly still: boolean;
  /** Glowy postaci — po nich ustawiamy dymek nad mowca. */
  readonly heads: RefObject<Map<CharacterId, Object3D>>;
}

function Character({ id, gltf, spot, action, still, heads }: CharacterProps) {
  const root = useRef<Group>(null);
  const joints = useMemo(() => {
    const names: string[] = [];
    gltf.scene.traverse((o) => names.push(o.name));
    const missing = missingJoints(id, names);
    if (missing.length > 0) throw new Error(`Postaci ${id} brakuje stawow: ${missing.join(", ")}`);
    return jointsOf(id).map((joint) => [joint, gltf.scene.getObjectByName(joint) as Object3D] as const);
  }, [gltf, id]);

  // Postac stoi w swoim punkcie i patrzy tam, gdzie on; siedzaca opuszczamy tak, by biodra byly nad siedziskiem.
  useLayoutEffect(() => {
    const group = root.current;
    if (group === null) return;
    group.position.copy(spot.getWorldPosition(new Vector3()));
    group.quaternion.copy(spot.getWorldQuaternion(new Quaternion()));
    group.updateMatrixWorld(true);
    // Wysokosc bioder liczona w ukladzie postaci — nie swiata, bo grupa juz stoi w swoim punkcie.
    const hips = gltf.scene.getObjectByName("hips") as Object3D;
    if (isSeated(id)) group.position.y += 0.1 - group.worldToLocal(hips.getWorldPosition(new Vector3())).y;
    heads.current.set(id, gltf.scene.getObjectByName("head") as Object3D);
  }, [gltf, id, spot, heads]);

  const since = useRef({ action, start: 0 });
  const current = useRef<Pose | null>(null);
  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime;
    if (since.current.action !== action) since.current = { action, start: now };
    const goal = pose(id, action, now - since.current.start, { still });
    const p = still || current.current === null ? goal : approach(current.current, goal, dt);
    current.current = p;
    for (const [joint, object] of joints) {
      const [x, y, z] = p[joint] ?? [0, 0, 0];
      object.rotation.set(x, y, z);
    }
  });

  return (
    <group ref={root}>
      <primitive object={gltf.scene} />
    </group>
  );
}

function CameraRig({ shot, anchor, still }: { readonly shot: Shot; readonly anchor: (name: string) => Object3D; readonly still: boolean }) {
  const camera = useThree((s) => s.camera);
  const current = useRef<{ eye: Vec3; target: Vec3 } | null>(null);
  // Sala jest nieruchoma: punkty ujecia liczymy raz na zmiane ujecia, nie w kazdej klatce.
  const goal = useMemo(() => {
    const nodes = shotNodes(shot);
    const at = (name: string): Vec3 => anchor(name).getWorldPosition(new Vector3()).toArray();
    return { eye: at(nodes.eye), target: at(nodes.target) };
  }, [shot, anchor]);
  useFrame((_, dt) => {
    const step = still || current.current === null ? Number.POSITIVE_INFINITY : dt;
    const from = current.current ?? goal;
    current.current = { eye: dampVec(from.eye, goal.eye, CAMERA_RATE, step), target: dampVec(from.target, goal.target, CAMERA_RATE, step) };
    camera.position.set(...current.current.eye);
    camera.lookAt(...current.current.target);
  });
  return null;
}

const ABOVE_HEAD = new Vector3(0, 0.75, 0);

function BubbleTracker({ who, heads, place }: { readonly who: CharacterId | null; readonly heads: RefObject<Map<CharacterId, Object3D>>; readonly place: PlaceBubble }) {
  const { camera, size } = useThree();
  useFrame(() => {
    const head = who === null ? undefined : heads.current.get(who);
    if (head === undefined) return;
    const point = head.localToWorld(ABOVE_HEAD.clone()).project(camera);
    const { x, y, visible } = toScreen([point.x, point.y, point.z], size.width, size.height);
    place(x, y, visible);
  });
  return null;
}
